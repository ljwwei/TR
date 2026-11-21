/**
 * Cloudflare Worker — 台鐵 TDX 採集準點排程觸發器（方案 B 混合架構）
 *
 * 功能：
 * 1. 每 30 分鐘準點（0,30 * * * *）自動呼叫 GitHub Actions workflow_dispatch，
 *    徹底取代延遲與漏跑嚴重的 GitHub Actions 內建 cron。
 * 2. 開啟 Worker 網址（GET /）即可檢查設定狀態；亦可於 Cloudflare 後台點選「Test Scheduled」實測。
 *
 * 必填 Secret（於 Cloudflare Worker Settings -> Variables and Secrets 新增）：
 *   GITHUB_PAT      GitHub Fine-grained PAT（僅需勾選 ljwwei/TR 的 Actions: Read and write）
 *
 * 選填環境變數（預設皆已指向 ljwwei/TR）：
 *   GITHUB_OWNER    預設 "ljwwei"
 *   GITHUB_REPO     預設 "TR"
 *   WORKFLOW_FILE   預設 "collect-tdx.yml"
 *   GIT_REF         預設 "main"
 *   COLLECT_SCOPE   預設 "all"（可改 "major"）
 *   TRIGGER_SECRET  選填，若設定即可透過 POST /trigger?key=... 遠端手動觸發
 */

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
        "User-Agent": "tra-tdx-cloudflare-cron/1.0",
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

    // 遇短暫 5xx 再重試一次
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
    ctx.waitUntil(
      dispatchGitHubWorkflow(env, "cloudflare-cron")
        .then((res) => console.log("[OK] Dispatched TRA collector:", JSON.stringify(res)))
        .catch((err) => {
          console.error("[ERROR] Dispatch failed:", err.message);
          throw err;
        })
    );
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    const owner = env.GITHUB_OWNER || "ljwwei";
    const repo = env.GITHUB_REPO || "TR";
    const workflowFile = env.WORKFLOW_FILE || "collect-tdx.yml";

    // 選用：手動觸發端點（需設定 TRIGGER_SECRET 以防外人濫用）
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

    // 健康檢查端點（GET /）
    return Response.json({
      ok: true,
      service: "tra-tdx-cloudflare-cron",
      target: `${owner}/${repo}/${workflowFile}`,
      schedule_utc: "0,30 * * * *",
      github_pat_configured: Boolean((env.GITHUB_PAT || "").trim()),
      scope: env.COLLECT_SCOPE || "all",
      now_utc: new Date().toISOString(),
    });
  },
};
