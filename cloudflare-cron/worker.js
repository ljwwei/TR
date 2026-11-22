/**
 * Cloudflare Worker — 台鐵 TDX 採集準點排程觸發器（強化診斷與尖峰 15 分鐘排程版）
 *
 * 排程（定義於 wrangler.toml）：
 * - 台灣 05:00–23:59（UTC 21:00–15:59）：每 15 分鐘準點觸發（貼合 TDX 10–15 分鐘看板視窗）
 * - 台灣 00:00–04:59（UTC 16:00–20:59）：每 30 分鐘準點觸發（涵蓋深夜末班車與跨日列車）
 *
 * 端點：
 * - GET /                健康檢查與 GitHub Token 驗證狀態（唯讀）
 * - GET /dispatch-check  立即實測觸發一次 GitHub Actions（內建 10 分鐘節流防濫用，直接回傳 GitHub API 結果）
 */

let lastCronResult = null;

function detectTokenType(token) {
  if (!token) return "missing";
  if (token.startsWith("github_pat_")) return "fine-grained (github_pat_)";
  if (token.startsWith("ghp_")) return "classic (ghp_)";
  if (token.startsWith("gho_") || token.startsWith("ghu_")) return "oauth/app";
  return `other (len=${token.length})`;
}

async function checkGitHubAuth(env) {
  const token = (env.GITHUB_PAT || "").trim();
  if (!token) {
    return { ok: false, status: 0, error: "GITHUB_PAT is empty" };
  }
  const owner = env.GITHUB_OWNER || "ljwwei";
  const repo = env.GITHUB_REPO || "TR";
  const workflowFile = env.WORKFLOW_FILE || "collect-tdx.yml";

  try {
    const resp = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflowFile}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "tra-tdx-cloudflare-cron/1.1",
        },
      }
    );
    const bodyText = await resp.text();
    let parsed = null;
    try {
      parsed = JSON.parse(bodyText);
    } catch {}
    return {
      ok: resp.ok,
      status: resp.status,
      workflow_state: parsed?.state || null,
      oauth_scopes: resp.headers.get("x-oauth-scopes") || null,
      accepted_permissions: resp.headers.get("x-accepted-github-permissions") || null,
      error: resp.ok ? null : (parsed?.message || bodyText.slice(0, 200)),
    };
  } catch (err) {
    return { ok: false, status: 0, error: err.message };
  }
}

async function dispatchGitHubWorkflow(env, sourceLabel = "cloudflare-cron") {
  const token = (env.GITHUB_PAT || "").trim();
  if (!token) {
    throw new Error("Missing required secret: GITHUB_PAT");
  }

  const owner = env.GITHUB_OWNER || "ljwwei";
  const repo = env.GITHUB_REPO || "TR";
  const workflowFile = env.WORKFLOW_FILE || "collect-tdx.yml";
  const ref = env.GIT_REF || "main";
  const scope = env.COLLECT_SCOPE || "all";

  const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflowFile}/dispatches`;
  const payload = JSON.stringify({
    ref,
    inputs: {
      scope,
      trigger_source: sourceLabel,
    },
  });

  let lastStatus = 0;
  let lastBody = "";

  for (let attempt = 1; attempt <= 2; attempt++) {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "tra-tdx-cloudflare-cron/1.1",
        "Content-Type": "application/json",
      },
      body: payload,
    });

    if (resp.status === 204 || resp.ok) {
      return {
        ok: true,
        status: resp.status,
        target: `${owner}/${repo}/${workflowFile}@${ref}`,
        scope,
        source: sourceLabel,
        triggered_at: new Date().toISOString(),
      };
    }

    lastStatus = resp.status;
    lastBody = await resp.text();

    if (resp.status >= 500 && attempt < 2) {
      await new Promise((r) => setTimeout(r, 1500));
      continue;
    }
    break;
  }

  throw new Error(`GitHub API ${lastStatus}: ${lastBody.slice(0, 300)}`);
}

export default {
  async scheduled(event, env, ctx) {
    const runTask = (async () => {
      try {
        const res = await dispatchGitHubWorkflow(env, "cloudflare-cron");
        lastCronResult = {
          cron: event.cron,
          scheduled_time: new Date(event.scheduledTime).toISOString(),
          ...res,
        };
        console.log("[OK] Dispatched TRA collector:", JSON.stringify(lastCronResult));
      } catch (err) {
        lastCronResult = {
          cron: event.cron,
          scheduled_time: new Date(event.scheduledTime).toISOString(),
          ok: false,
          error: err.message,
          at: new Date().toISOString(),
        };
        console.error("[ERROR] Dispatch failed:", err.message);
        throw err;
      }
    })();
    ctx.waitUntil(runTask);
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    const owner = env.GITHUB_OWNER || "ljwwei";
    const repo = env.GITHUB_REPO || "TR";
    const workflowFile = env.WORKFLOW_FILE || "collect-tdx.yml";
    const token = (env.GITHUB_PAT || "").trim();

    // 內建 10 分鐘節流的診斷觸發端點（GET /dispatch-check）
    if (url.pathname === "/dispatch-check") {
      const cache = caches.default;
      const lockUrl = new Request("https://tra-tdx-cron.internal/dispatch-lock");
      const existing = await cache.match(lockUrl);
      if (existing) {
        const prev = await existing.json();
        return Response.json(
          {
            ok: prev.ok,
            throttled: true,
            message: "10 分鐘內已執行過測試觸發，以下為最近一次結果",
            last_result: prev,
          },
          { status: 200 }
        );
      }

      let result;
      try {
        result = await dispatchGitHubWorkflow(env, "cloudflare-verify");
      } catch (err) {
        result = { ok: false, error: err.message, at: new Date().toISOString() };
      }

      await cache.put(
        lockUrl,
        new Response(JSON.stringify(result), {
          headers: { "Content-Type": "application/json", "Cache-Control": "max-age=600" },
        })
      );
      return Response.json(result, { status: result.ok ? 200 : 502 });
    }

    // 選用：帶密鑰的手動觸發端點
    if (url.pathname === "/trigger" && (request.method === "POST" || request.method === "GET")) {
      const secret = (env.TRIGGER_SECRET || "").trim();
      const provided =
        url.searchParams.get("key") ||
        (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();

      if (!secret || provided !== secret) {
        return Response.json(
          { ok: false, error: "Unauthorized. Set TRIGGER_SECRET and pass ?key=..." },
          { status: 401 }
        );
      }

      try {
        const result = await dispatchGitHubWorkflow(env, "cloudflare-manual");
        return Response.json(result, { status: 200 });
      } catch (err) {
        return Response.json({ ok: false, error: err.message }, { status: 502 });
      }
    }

    // 健康與權限診斷端點（GET /）
    const authCheck = await checkGitHubAuth(env);
    return Response.json({
      ok: true,
      service: "tra-tdx-cloudflare-cron",
      version: "1.1",
      target: `${owner}/${repo}/${workflowFile}`,
      schedules_utc: ["0,15,30,45 0-15,21-23 * * *", "0,30 16-20 * * *"],
      schedules_taipei: "05:00-23:45 每15分鐘；00:00-04:30 每30分鐘",
      github_pat_configured: Boolean(token),
      token_type: detectTokenType(token),
      github_auth_check: authCheck,
      last_cron_result: lastCronResult,
      scope: env.COLLECT_SCOPE || "all",
      now_utc: new Date().toISOString(),
    });
  },
};
