/**
 * 台鐵準誤點分析統計儀表板 — 主控制器
 * 自動偵測 data/live/manifest.json（真實 TDX 累積數據）與 data/demo/manifest.json（示範資料），
 * 支援單日／單月／單年切換、本島 19 縣市主站／全臺所有車站切換、官方 ≤5分／嚴格 0分 標準即時重算。
 */

import {
  isMobileViewport,
  renderDelayDistChart,
  renderHeatmapChart,
  renderRegionsChart,
  renderStationDrilldownCharts,
  renderTaiwanMap,
  renderTrainTypesChart,
  renderTrendChart,
  resizeAllCharts,
} from "./charts.js";
import {
  BUCKET_COLORS,
  BUCKET_LABELS,
  buildCommuterInsights,
  calcAvgDelay,
  calcDelayedOnlyAvg,
  calcOntimeCount,
  calcOntimeRate,
  exportStationsCsv,
  fmtMin,
  fmtNum,
  fmtPct,
  formatIsoShort,
  getGradeInfo,
  getRateColor,
  getRatePillClass,
} from "./utils.js";

const state = {
  source: "demo", // "live" | "demo"
  manifests: { live: null, demo: null },
  stationsCatalog: null,
  majorOrder: [],
  majorSet: new Set(),

  granularity: "daily", // "daily" | "monthly" | "yearly"
  period: null,
  scope: "major", // "major" | "all"
  standard: "official", // "official" (<=5m) | "strict" (0m)

  rankSort: "ontime_asc",
  tableTab: "stations",
  regionFilter: "all",
  searchQuery: "",

  cache: new Map(),
  currentDoc: null,
  prevDoc: null,
  activeStationRows: [],
  openStationId: null,
  mapRoamEnabled: false,
  lastIsMobile: window.innerWidth <= 768,
};

const $ = (id) => document.getElementById(id);

async function fetchJsonSafe(url) {
  try {
    const mode = url.includes("manifest.json") ? "no-store" : "no-cache";
    const resp = await fetch(url, { cache: mode });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

function initTheme() {
  const saved = localStorage.getItem("tra_theme");
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const theme = saved || (prefersDark ? "dark" : "light");
  applyTheme(theme);
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("tra_theme", theme);
  $("iconSun").classList.toggle("hidden", theme !== "dark");
  $("iconMoon").classList.toggle("hidden", theme === "dark");
}

async function bootstrap() {
  initTheme();
  bindEvents();

  const [stationsJson, liveManifest, demoManifest] = await Promise.all([
    fetchJsonSafe("./data/stations.json"),
    fetchJsonSafe("./data/live/manifest.json"),
    fetchJsonSafe("./data/demo/manifest.json"),
  ]);

  state.stationsCatalog = stationsJson?.stations || {};
  state.majorOrder = stationsJson?.major_station_ids || [];
  state.majorSet = new Set(state.majorOrder);
  state.manifests.live = liveManifest && liveManifest.available?.daily?.length ? liveManifest : null;
  state.manifests.demo = demoManifest;

  // 若已有真實 TDX 累積資料，預設優先啟用真實資料！
  if (state.manifests.live) {
    state.source = "live";
    $("btnSourceSwitch").classList.remove("hidden");
  } else if (state.manifests.demo) {
    state.source = "demo";
  } else {
    $("dataSourceBadge").textContent = "找不到資料檔";
    return;
  }

  syncSourceUI();
  populatePeriodOptions();
  await loadAndRenderCurrent();
}

function getActiveManifest() {
  return state.manifests[state.source];
}

function syncSourceUI() {
  const manifest = getActiveManifest();
  const badge = $("dataSourceBadge");
  const banner = $("noticeBanner");
  const switchLabel = $("sourceSwitchLabel");

  if (state.source === "live") {
    badge.className = "status-pill status-pill--live";
    badge.textContent = `TDX 真實即時累積・更新 ${formatIsoShort(manifest?.generated_at)}`;
    switchLabel.textContent = "切換預覽完整年度示範";
    const totalDays = manifest?.available?.daily?.length || 0;
    if (totalDays <= 2) {
      banner.className = "notice-banner notice-banner--live";
      banner.innerHTML = `
        <div>
          <strong>TDX 真實即時採集已成功連線！</strong>
          已自動同步全臺 <strong>${manifest?.station_count || 245}</strong> 座車站，目前剛開始累積第 ${totalDays} 天即時數據；系統由 Cloudflare 準點排程（日間每 15 分鐘、深夜每 30 分鐘）自動更新並累計單日／單月／單年統計。
        </div>
        <button type="button" class="notice-action" id="btnBannerPreviewDemo">預覽完整年度示範</button>
      `;
      const btn = $("btnBannerPreviewDemo");
      if (btn) {
        btn.addEventListener("click", async () => {
          state.source = "demo";
          syncSourceUI();
          populatePeriodOptions();
          await loadAndRenderCurrent();
        });
      }
    } else {
      banner.className = "notice-banner notice-banner--live hidden";
    }
  } else if (state.manifests.live) {
    badge.className = "status-pill status-pill--demo";
    badge.textContent = "完整年度示範預覽（TDX 運作中）";
    switchLabel.textContent = "返回 TDX 真實即時數據";
    banner.className = "notice-banner notice-banner--demo";
    banner.innerHTML = `
      <div>
        <strong>目前正在預覽「完整年度示範資料」：</strong>
        您的 TDX API 已設定成功且自動採集正常運作中（最新真實更新：<strong>${formatIsoShort(state.manifests.live.generated_at)}</strong>，已同步全臺 ${state.manifests.live.station_count || 245} 站）。隨時可點右側按鈕切回真實數據。
      </div>
      <button type="button" class="notice-action" id="btnBannerBackLive">返回 TDX 真實即時數據</button>
    `;
    const btn = $("btnBannerBackLive");
    if (btn) {
      btn.addEventListener("click", async () => {
        state.source = "live";
        syncSourceUI();
        populatePeriodOptions();
        await loadAndRenderCurrent();
      });
    }
  } else {
    badge.className = "status-pill status-pill--demo";
    badge.textContent = "示範展示資料（尚未連線 TDX）";
    switchLabel.textContent = "返回 TDX 真實即時數據";
    banner.className = "notice-banner notice-banner--demo";
    banner.innerHTML = `
      <div>
        <strong>目前顯示為介面展示用示範資料：</strong>
        由於 TDX <code>StationLiveBoard</code> 僅提供即時動態（不回溯歷史），請至 GitHub 專案設定
        <code>TDX_CLIENT_ID</code> 與 <code>TDX_CLIENT_SECRET</code> 後執行排程，系統將自動切換為您帳號累積的真實台鐵數據。
      </div>
      <button type="button" class="notice-action" id="btnBannerSetup">查看 2 分鐘設定步驟</button>
    `;
    const btn = $("btnBannerSetup");
    if (btn) btn.addEventListener("click", () => openModal("aboutModal"));
  }

  // 更新總車站數徽章
  const stCount = manifest?.station_count || Object.keys(state.stationsCatalog).length;
  $("allStationCount").textContent = stCount ? `(${stCount})` : "";

  // 更新 API 額度監控卡片
  const q = manifest?.quota || {};
  const pts = Number(q.estimated_points || 0);
  const maxPts = Number(q.free_tier_points || 3.0);
  const pct = Math.min(100, (pts / maxPts) * 100);
  $("quotaPointsText").textContent = `${pts.toFixed(2)} / ${maxPts.toFixed(2)} 點`;
  $("quotaBarFill").style.width = `${pct}%`;
  $("quotaBarFill").style.background = pct > 80 ? "#EA580C" : "#059669";
  $("quotaCallsText").textContent = `呼叫：${fmtNum(q.api_calls || 0)} 次`;
  $("quotaBytesText").textContent = `流量：${((q.bytes_downloaded || 0) / (1024 * 1024)).toFixed(1)} MB`;
}

function formatPeriodOptionLabel(granularity, key) {
  if (granularity === "daily") return key;
  if (granularity === "monthly") {
    const [y, m] = key.split("-");
    return `${y} 年 ${Number(m)} 月`;
  }
  return `${key} 年度`;
}

function populatePeriodOptions(preferredKey = null) {
  const manifest = getActiveManifest();
  const list = manifest?.available?.[state.granularity] || [];
  const select = $("periodSelect");
  select.innerHTML = "";

  for (const key of list) {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = formatPeriodOptionLabel(state.granularity, key);
    select.appendChild(opt);
  }

  if (preferredKey && list.includes(preferredKey)) {
    state.period = preferredKey;
  } else {
    state.period = list[0] || null;
  }
  if (state.period) select.value = state.period;
  updatePeriodNavArrows();
}

function updatePeriodNavArrows() {
  const list = getActiveManifest()?.available?.[state.granularity] || [];
  const idx = list.indexOf(state.period);
  // list 採新到舊排序（index 0 為最新）
  $("btnNextPeriod").disabled = idx <= 0;
  $("btnPrevPeriod").disabled = idx < 0 || idx >= list.length - 1;
}

async function loadPeriodDoc(granularity, periodKey) {
  if (!periodKey) return null;
  const cacheKey = `${state.source}|${granularity}|${periodKey}`;
  if (state.cache.has(cacheKey)) return state.cache.get(cacheKey);
  const url = `./data/${state.source}/${granularity}/${periodKey}.json`;
  const doc = await fetchJsonSafe(url);
  if (doc) state.cache.set(cacheKey, doc);
  return doc;
}

async function loadAndRenderCurrent() {
  if (!state.period) return;
  const list = getActiveManifest()?.available?.[state.granularity] || [];
  const idx = list.indexOf(state.period);
  const prevKey = idx >= 0 && idx + 1 < list.length ? list[idx + 1] : null;

  const [doc, prevDoc] = await Promise.all([
    loadPeriodDoc(state.granularity, state.period),
    prevKey ? loadPeriodDoc(state.granularity, prevKey) : Promise.resolve(null),
  ]);

  if (!doc) return;
  state.currentDoc = doc;
  state.prevDoc = prevDoc;
  renderAll();
}

function buildStationRows(doc) {
  const rows = [];
  const stationsData = doc.stations || {};

  for (const [sid, st] of Object.entries(stationsData)) {
    const isMajor = state.majorSet.has(sid);
    if (state.scope === "major" && !isMajor) continue;
    if (!st.total) continue;

    const meta = state.stationsCatalog[sid] || {
      id: sid,
      name: sid,
      city: "其他",
      region: "北部",
      line: "臺鐵",
      lat: null,
      lon: null,
      is_major: isMajor,
    };

    rows.push({
      id: sid,
      name: meta.name,
      city: meta.city || "其他",
      region: meta.region || "北部",
      line: meta.line || "臺鐵",
      lat: meta.lat,
      lon: meta.lon,
      isMajor,
      geoIdx: state.majorOrder.indexOf(sid),
      total: st.total,
      ontime_0: st.ontime_0,
      ontime_5: st.ontime_5,
      delay_sum: st.delay_sum,
      delayed_gt0: st.delayed_gt0,
      delayed_gt5: st.delayed_gt5,
      max_delay: st.max_delay,
      cancelled: st.cancelled || 0,
      rate0: calcOntimeRate(st, "strict"),
      rate5: calcOntimeRate(st, "official"),
      avgDelay: calcAvgDelay(st),
      raw: st,
    });
  }
  return rows;
}

function renderAll() {
  const doc = state.currentDoc;
  if (!doc) return;

  const scopeBlock = doc.scope_stats?.[state.scope] || doc.scope_stats?.all;
  const prevBlock = state.prevDoc?.scope_stats?.[state.scope] || state.prevDoc?.scope_stats?.all;
  const rows = buildStationRows(doc);
  state.activeStationRows = rows;

  renderHeaderMeta(doc, scopeBlock, rows);
  renderInsights(scopeBlock, rows);
  renderKpis(scopeBlock, prevBlock, rows);
  renderRankList(rows);
  renderDirectionCards(scopeBlock);
  renderBucketPills(scopeBlock.summary);
  renderTables(rows, scopeBlock.top_delays || []);

  // Charts
  syncMapToolsUI();
  const effectiveRoam = isMobileViewport() ? state.mapRoamEnabled : true;
  renderTaiwanMap(rows, state.standard, openStationModal, effectiveRoam);
  renderTrendSection(scopeBlock);
  renderDelayDistChart(scopeBlock.summary);
  renderTrainTypesChart(scopeBlock.train_types, state.standard);
  renderHeatmapChart(scopeBlock.region_hour_matrix);
  renderRegionsChart(scopeBlock.regions, state.standard);

  if (state.openStationId) {
    renderStationModalContent(state.openStationId);
  }
}

function syncMapToolsUI() {
  const roamBtn = $("btnMapRoam");
  if (!roamBtn) return;
  const mobile = isMobileViewport();
  roamBtn.classList.toggle("hidden", !mobile);
  roamBtn.classList.toggle("active", state.mapRoamEnabled);
  roamBtn.textContent = state.mapRoamEnabled ? "鎖定捲動" : "啟用縮放";
}

function renderHeaderMeta(doc, scopeBlock, rows) {
  const scopeText = state.scope === "major" ? "本島 19 縣市代表站" : `全台 ${rows.length} 座車站`;
  const daysText = doc.days_covered > 1 ? `・涵蓋 ${doc.days_covered} 天` : "";
  $("periodMetaInfo").textContent = `${doc.label}・${scopeText}${daysText}`;
  $("rankTitle").textContent =
    state.scope === "major" ? "本島 19 縣市主要車站排行" : `全台車站準誤點排行（共 ${rows.length} 站）`;
}

function renderInsights(scopeBlock, rows) {
  const list = buildCommuterInsights(scopeBlock, rows, state.standard);
  $("insightsList").innerHTML = list
    .map(
      (item) =>
        `<div class="insight-item ${item.type === "warn" ? "insight-item--warn" : item.type === "good" ? "insight-item--good" : ""}">${item.html}</div>`
    )
    .join("");
}

function renderKpis(scopeBlock, prevBlock, rows) {
  const s = scopeBlock.summary;
  const hasData = s && s.total > 0;
  const rate = hasData ? calcOntimeRate(s, state.standard) : 0;
  const ontimeCount = hasData ? calcOntimeCount(s, state.standard) : 0;
  const avgDelay = hasData ? calcAvgDelay(s) : 0;
  const delayedOnlyAvg = hasData ? calcDelayedOnlyAvg(s) : 0;
  const grade = hasData ? getGradeInfo(rate, state.standard) : { label: "累積中", cls: "kpi-tag" };

  $("kpiOntimeLabel").textContent =
    state.standard === "strict" ? "整體嚴格準點率（0分）" : "整體準點率（≤ 5分）";
  $("kpiOntimeRate").textContent = hasData ? fmtPct(rate) : "--.-%";
  $("kpiOntimeGrade").textContent = grade.label;
  $("kpiOntimeGrade").className = `grade-pill ${grade.cls}`;
  $("kpiOntimeBar").style.width = hasData ? `${Math.max(0, Math.min(100, rate))}%` : "0%";
  $("kpiOntimeBar").style.background = hasData ? getRateColor(rate, state.standard) : "var(--border)";
  $("kpiOntimeSub").textContent = hasData
    ? `準點 ${fmtNum(ontimeCount)} / 總計 ${fmtNum(s.total)} 班次`
    : "本期範圍尚無觀測班次，可切換「全台所有車站」";

  const deltaEl = $("kpiOntimeDelta");
  if (hasData && prevBlock?.summary?.total) {
    const prevRate = calcOntimeRate(prevBlock.summary, state.standard);
    const diff = rate - prevRate;
    const sign = diff >= 0 ? "+" : "";
    deltaEl.textContent = `較前期 ${sign}${diff.toFixed(1)}%`;
    deltaEl.className = `delta-badge ${diff >= 0 ? "delta-up" : "delta-down"}`;
  } else {
    deltaEl.textContent = "";
  }

  $("kpiTotalTrains").textContent = fmtNum(s.total);
  $("kpiStationsCovered").textContent = `${rows.length} 站`;
  $("kpiTotalSub").textContent =
    s.cancelled > 0 ? `含停駛/取消 ${fmtNum(s.cancelled)} 班次` : "跨站去重之有效車次觀測樣本";

  $("kpiAvgDelay").textContent = hasData ? fmtMin(avgDelay) : "--";
  $("kpiP90Badge").textContent = hasData ? `P90 ${s.p90_delay || 0}分` : "P90 --";
  $("kpiAvgDelaySub").textContent = hasData
    ? `僅計誤點班次平均：${fmtMin(delayedOnlyAvg)} 分・最大 ${s.max_delay} 分`
    : "等待列車運行觀測資料";

  // 最佳與最需留意車站（至少 5 班次以上才納入比較，避免極小樣本失真）
  const eligible = rows.filter((r) => r.total >= 5);
  const pool = eligible.length ? eligible : rows;
  if (pool.length) {
    const byRate = [...pool].sort((a, b) => {
      const ra = state.standard === "strict" ? a.rate0 : a.rate5;
      const rb = state.standard === "strict" ? b.rate0 : b.rate5;
      return rb - ra || a.avgDelay - b.avgDelay;
    });
    const best = byRate[0];
    const worst = [...pool].sort((a, b) => b.avgDelay - a.avgDelay)[0];

    const bestRate = state.standard === "strict" ? best.rate0 : best.rate5;
    $("kpiBestStation").textContent = `${best.name}站`;
    $("kpiBestRate").textContent = fmtPct(bestRate);
    $("kpiBestSub").textContent = `${best.city}・平均誤點 ${fmtMin(best.avgDelay)} 分（點擊詳情）`;
    $("kpiBestCard").dataset.stationId = best.id;

    const worstRate = state.standard === "strict" ? worst.rate0 : worst.rate5;
    $("kpiWorstStation").textContent = `${worst.name}站`;
    $("kpiWorstDelay").textContent = `${fmtMin(worst.avgDelay)}分`;
    $("kpiWorstSub").textContent = `${worst.city}・準點率 ${fmtPct(worstRate)}（點擊詳情）`;
    $("kpiWorstCard").dataset.stationId = worst.id;
  } else {
    $("kpiBestStation").textContent = "--";
    $("kpiBestRate").textContent = "--%";
    $("kpiBestSub").textContent = "本期尚無車站資料";
    delete $("kpiBestCard").dataset.stationId;
    $("kpiWorstStation").textContent = "--";
    $("kpiWorstDelay").textContent = "--分";
    $("kpiWorstSub").textContent = "本期尚無車站資料";
    delete $("kpiWorstCard").dataset.stationId;
  }
}

function renderRankList(rows) {
  const sorted = [...rows];
  const getRate = (r) => (state.standard === "strict" ? r.rate0 : r.rate5);

  switch (state.rankSort) {
    case "ontime_desc":
      sorted.sort((a, b) => getRate(b) - getRate(a) || a.avgDelay - b.avgDelay);
      break;
    case "avg_desc":
      sorted.sort((a, b) => b.avgDelay - a.avgDelay);
      break;
    case "total_desc":
      sorted.sort((a, b) => b.total - a.total);
      break;
    case "geo":
      sorted.sort((a, b) => (a.geoIdx >= 0 ? a.geoIdx : 999) - (b.geoIdx >= 0 ? b.geoIdx : 999) || a.id.localeCompare(b.id));
      break;
    default:
      sorted.sort((a, b) => getRate(a) - getRate(b) || b.avgDelay - a.avgDelay);
      break;
  }

  const container = $("stationRankList");
  container.innerHTML = sorted
    .map((r, i) => {
      const rate = getRate(r);
      const color = getRateColor(rate, state.standard);
      return `
        <div class="rank-row" data-open-station="${r.id}" role="button" tabindex="0">
          <span class="rank-idx">${i + 1}</span>
          <div class="rank-station">
            <span class="rank-station-name">${r.isMajor ? '<span class="major-dot" title="本島縣市代表站"></span>' : ""}${r.name}站</span>
            <span class="rank-station-city">${r.city}・${r.line}</span>
          </div>
          <div class="rank-bar-wrap">
            <div class="rank-bar-val" style="width:${Math.max(4, Math.min(100, rate))}%;background:${color}"></div>
          </div>
          <span class="rank-pct" style="color:${color}">${fmtPct(rate)}</span>
          <span class="rank-delay">${fmtMin(r.avgDelay)}分</span>
        </div>
      `;
    })
    .join("");
}

function renderTrendSection(scopeBlock) {
  const titleEl = $("trendChartTitle");
  const descEl = $("trendChartDesc");
  const hintEl = $("trendHint");

  if (state.granularity === "daily") {
    titleEl.textContent = "單日 24 小時各時段準誤點曲線";
    descEl.textContent = "觀察全天候各時段（含深夜跨日班次與早晚尖峰）準點率與平均延誤變化";
    hintEl.textContent = "24 小時全時段分析（含跨夜班次）";
  } else if (state.granularity === "monthly") {
    titleEl.textContent = "單月每日準誤點趨勢分析";
    descEl.textContent = "追蹤整月波動與異常高峰日期；點擊任意日期資料點可直接下鑽單日分析";
    hintEl.textContent = "點擊圖表日期可下鑽單日";
  } else {
    titleEl.textContent = "單年 1–12 月季節性準誤點趨勢";
    descEl.textContent = "觀察全年度各月趨勢與天候季節影響；點擊任意月份資料點可直接下鑽單月分析";
    hintEl.textContent = "點擊圖表月份可下鑽單月";
  }

  renderTrendChart(scopeBlock.trend || [], state.granularity, state.standard, async (targetKey) => {
    const nextGran = state.granularity === "yearly" ? "monthly" : "daily";
    const avail = getActiveManifest()?.available?.[nextGran] || [];
    if (!avail.includes(targetKey)) return;
    state.granularity = nextGran;
    syncSegmentedButtons("granularity", nextGran);
    populatePeriodOptions(targetKey);
    await loadAndRenderCurrent();
  });
}

function renderBucketPills(summary) {
  const buckets = summary?.buckets || [0, 0, 0, 0, 0];
  const total = summary?.total || 1;
  $("delayBucketPills").innerHTML = BUCKET_LABELS.map((lbl, idx) => {
    const pct = summary?.total ? ((buckets[idx] / total) * 100).toFixed(1) : "0.0";
    return `
      <div class="bucket-pill" style="--bucket-color:${BUCKET_COLORS[idx]}">
        <span class="bucket-pill-label">${lbl}</span>
        <span class="bucket-pill-val">${pct}%</span>
      </div>
    `;
  }).join("");
}

function renderDirectionCards(scopeBlock) {
  const dirs = scopeBlock.directions || {};
  const entries = [
    { key: "0", title: "順行（北上／往臺北基隆）", icon: "↑" },
    { key: "1", title: "逆行（南下／往高雄臺東）", icon: "↓" },
  ];
  $("directionCards").innerHTML = entries
    .map((e) => {
      const d = dirs[e.key] || { total: 0, ontime_0: 0, ontime_5: 0, delay_sum: 0 };
      const has = d.total > 0;
      const rate = has ? calcOntimeRate(d, state.standard) : 0;
      const avg = has ? calcAvgDelay(d) : 0;
      return `
        <div class="dir-card">
          <div class="dir-card-title">${e.icon} ${e.title}</div>
          <div class="dir-metrics">
            <span class="dir-rate" style="color:${has ? getRateColor(rate, state.standard) : "var(--text-muted)"}">${has ? fmtPct(rate) : "--.-%"}</span>
            <span class="mono" style="font-size:0.84rem;color:var(--text-secondary)">${has ? `平均 ${fmtMin(avg)} 分` : "尚無資料"}</span>
          </div>
          <div class="dir-sub">統計班次：${fmtNum(d.total)} 班${has ? `・最大誤點 ${d.max_delay || 0} 分` : ""}</div>
        </div>
      `;
    })
    .join("");
}

function renderTables(rows, topDelays) {
  const q = state.searchQuery.trim().toLowerCase();
  const reg = state.regionFilter;

  const filteredStations = rows
    .filter((r) => (reg === "all" ? true : r.region === reg))
    .filter((r) => !q || r.name.toLowerCase().includes(q) || r.city.toLowerCase().includes(q) || r.id.includes(q) || r.line.toLowerCase().includes(q))
    .sort((a, b) => (state.standard === "strict" ? a.rate0 - b.rate0 : a.rate5 - b.rate5));

  $("stationsTableBody").innerHTML = filteredStations.length
    ? filteredStations
        .map(
          (r) => `
      <tr>
        <td><strong>${r.isMajor ? '<span class="major-dot" title="本島縣市代表站"></span>' : ""}${r.name}</strong> <span class="mono" style="opacity:.6;font-size:.76rem">${r.id}</span></td>
        <td>${r.city} <span style="opacity:.65">/ ${r.line}</span></td>
        <td class="num">${fmtNum(r.total)}</td>
        <td class="num"><span class="${getRatePillClass(r.rate5, "official")}">${fmtPct(r.rate5)}</span></td>
        <td class="num"><span class="${getRatePillClass(r.rate0, "strict")}">${fmtPct(r.rate0)}</span></td>
        <td class="num">${fmtMin(r.avgDelay)} 分</td>
        <td class="num">${r.max_delay} 分</td>
        <td class="num">${fmtNum(r.delayed_gt5)}</td>
        <td><button type="button" class="btn-table-action" data-open-station="${r.id}">單站分析</button></td>
      </tr>
    `
        )
        .join("")
    : `<tr><td colspan="9" style="text-align:center;padding:24px;color:var(--text-muted)">查無符合篩選條件的車站資料</td></tr>`;

  const filteredTrains = topDelays
    .filter((t) => {
      if (reg !== "all") {
        const stMeta = state.stationsCatalog[t.station_id];
        if (stMeta && stMeta.region !== reg) return false;
      }
      if (!q) return true;
      return (
        String(t.train_no).toLowerCase().includes(q) ||
        String(t.station_name).toLowerCase().includes(q) ||
        String(t.train_type).toLowerCase().includes(q) ||
        String(t.ending_station).toLowerCase().includes(q)
      );
    });

  $("trainsTableBody").innerHTML = filteredTrains.length
    ? filteredTrains
        .map(
          (t) => `
      <tr>
        <td class="mono">${t.date}</td>
        <td class="mono"><strong>${t.train_no}</strong></td>
        <td>${t.train_type}</td>
        <td><button type="button" class="btn-table-action" data-open-station="${t.station_id}">${t.station_name}站</button></td>
        <td>${t.ending_station ? `往 ${t.ending_station}` : "--"} <span style="opacity:.65">(${t.direction === 1 ? "逆行" : "順行"})</span></td>
        <td class="num">${t.schedule_time}</td>
        <td class="num"><span class="${t.delay > 15 ? "pill-bad" : t.delay > 5 ? "pill-orange" : "pill-amber"}">+${t.delay} 分</span></td>
        <td>${t.status}</td>
      </tr>
    `
        )
        .join("")
    : `<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--text-muted)">本期無高誤點紀錄或查無相符班次</td></tr>`;
}

function openStationModal(stationId) {
  if (!state.currentDoc?.stations?.[stationId]) return;
  state.openStationId = stationId;
  openModal("stationModal");
  renderStationModalContent(stationId);
}

function renderStationModalContent(stationId) {
  const st = state.currentDoc?.stations?.[stationId];
  if (!st) return;
  const meta = state.stationsCatalog[stationId] || { name: stationId, city: "其他", region: "北部", line: "臺鐵", is_major: false };

  $("modalStationTitle").textContent = `${meta.name}車站深度分析`;
  $("modalStationBadge").textContent = meta.is_major ? "本島縣市代表站" : meta.line;
  $("modalStationMeta").textContent = `${meta.city}・${meta.region}幹線・${meta.line}・代碼 ${stationId}・統計期間：${state.currentDoc.label}`;

  const rate = calcOntimeRate(st, state.standard);
  const avg = calcAvgDelay(st);
  $("modalStationKpis").innerHTML = `
    <div class="modal-kpi"><span>${state.standard === "strict" ? "嚴格準點率 (0分)" : "官方準點率 (≤5分)"}</span><strong style="color:${getRateColor(rate, state.standard)}">${fmtPct(rate)}</strong></div>
    <div class="modal-kpi"><span>觀測總班次</span><strong>${fmtNum(st.total)}</strong></div>
    <div class="modal-kpi"><span>平均誤點時間</span><strong>${fmtMin(avg)} 分</strong></div>
    <div class="modal-kpi"><span>最大單筆誤點</span><strong>${st.max_delay} 分</strong></div>
  `;

  const d0 = st.directions?.["0"] || [0, 0, 0, 0];
  const d1 = st.directions?.["1"] || [0, 0, 0, 0];
  const r0 = d0[0] > 0 ? ((state.standard === "strict" ? d0[1] : d0[2]) / d0[0]) * 100 : 0;
  const r1 = d1[0] > 0 ? ((state.standard === "strict" ? d1[1] : d1[2]) / d1[0]) * 100 : 0;
  $("modalStationDirSummary").innerHTML = `
    <div class="dir-card">
      <div class="dir-card-title">↑ 本站順行（北上）</div>
      <div class="dir-metrics"><span class="dir-rate" style="color:${getRateColor(r0, state.standard)}">${fmtPct(r0)}</span><span class="mono">均誤點 ${fmtMin(d0[0] ? d0[3] / d0[0] : 0)} 分</span></div>
      <div class="dir-sub">觀測 ${fmtNum(d0[0])} 班次</div>
    </div>
    <div class="dir-card">
      <div class="dir-card-title">↓ 本站逆行（南下）</div>
      <div class="dir-metrics"><span class="dir-rate" style="color:${getRateColor(r1, state.standard)}">${fmtPct(r1)}</span><span class="mono">均誤點 ${fmtMin(d1[0] ? d1[3] / d1[0] : 0)} 分</span></div>
      <div class="dir-sub">觀測 ${fmtNum(d1[0])} 班次</div>
    </div>
  `;

  // 確保 Modal 可見後再繪圖以取得正確寬高
  requestAnimationFrame(() => {
    renderStationDrilldownCharts(st, state.standard);
    resizeAllCharts();
  });
}

function openModal(modalId) {
  $(modalId).classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeModal(modalId) {
  $(modalId).classList.add("hidden");
  if (modalId === "stationModal") state.openStationId = null;
  document.body.style.overflow = "";
}

function syncSegmentedButtons(dataAttr, value) {
  document.querySelectorAll(`[data-${dataAttr}]`).forEach((btn) => {
    const active = btn.dataset[dataAttr] === value;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", String(active));
  });
}

function bindEvents() {
  // Granularity (單日 / 單月 / 單年)
  document.querySelectorAll("[data-granularity]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const g = btn.dataset.granularity;
      if (g === state.granularity) return;
      state.granularity = g;
      syncSegmentedButtons("granularity", g);
      populatePeriodOptions();
      await loadAndRenderCurrent();
    });
  });

  // Scope (19 縣市主站 / 全臺所有車站)
  document.querySelectorAll("[data-scope]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const sc = btn.dataset.scope;
      if (sc === state.scope) return;
      state.scope = sc;
      syncSegmentedButtons("scope", sc);
      renderAll();
    });
  });

  // Standard (官方 <=5分 / 嚴格 0分)
  document.querySelectorAll("[data-standard]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const st = btn.dataset.standard;
      if (st === state.standard) return;
      state.standard = st;
      syncSegmentedButtons("standard", st);
      renderAll();
    });
  });

  // Period Select & Arrows
  $("periodSelect").addEventListener("change", async (e) => {
    state.period = e.target.value;
    updatePeriodNavArrows();
    await loadAndRenderCurrent();
  });

  $("btnPrevPeriod").addEventListener("click", async () => {
    const list = getActiveManifest()?.available?.[state.granularity] || [];
    const idx = list.indexOf(state.period);
    if (idx >= 0 && idx + 1 < list.length) {
      state.period = list[idx + 1];
      $("periodSelect").value = state.period;
      updatePeriodNavArrows();
      await loadAndRenderCurrent();
    }
  });

  $("btnNextPeriod").addEventListener("click", async () => {
    const list = getActiveManifest()?.available?.[state.granularity] || [];
    const idx = list.indexOf(state.period);
    if (idx > 0) {
      state.period = list[idx - 1];
      $("periodSelect").value = state.period;
      updatePeriodNavArrows();
      await loadAndRenderCurrent();
    }
  });

  // Source switch (Live <-> Demo)
  $("btnSourceSwitch").addEventListener("click", async () => {
    state.source = state.source === "live" ? "demo" : "live";
    syncSourceUI();
    populatePeriodOptions();
    await loadAndRenderCurrent();
  });

  // Theme toggle
  $("btnThemeToggle").addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme");
    applyTheme(cur === "dark" ? "light" : "dark");
    renderAll();
  });

  // CSV export
  $("btnExportCsv").addEventListener("click", () => {
    if (!state.activeStationRows.length || !state.currentDoc) return;
    const scopeLabel = state.scope === "major" ? "本島19縣市主站" : "全台所有車站";
    exportStationsCsv(state.activeStationRows, state.currentDoc.period, scopeLabel);
  });

  // About modal
  $("btnAboutModal").addEventListener("click", () => openModal("aboutModal"));

  // Rank sort
  $("rankSortSelect").addEventListener("change", (e) => {
    state.rankSort = e.target.value;
    renderRankList(state.activeStationRows);
  });

  // Table tabs
  document.querySelectorAll("[data-table-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tableTab;
      state.tableTab = tab;
      document.querySelectorAll("[data-table-tab]").forEach((b) => {
        b.classList.toggle("active", b.dataset.tableTab === tab);
        b.setAttribute("aria-selected", String(b.dataset.tableTab === tab));
      });
      $("tabPanelStations").classList.toggle("hidden", tab !== "stations");
      $("tabPanelTrains").classList.toggle("hidden", tab !== "trains");
    });
  });

  // Table filters
  $("regionFilter").addEventListener("change", (e) => {
    state.regionFilter = e.target.value;
    const blk = state.currentDoc?.scope_stats?.[state.scope] || state.currentDoc?.scope_stats?.all;
    renderTables(state.activeStationRows, blk?.top_delays || []);
  });

  $("stationSearchInput").addEventListener("input", (e) => {
    state.searchQuery = e.target.value;
    const blk = state.currentDoc?.scope_stats?.[state.scope] || state.currentDoc?.scope_stats?.all;
    renderTables(state.activeStationRows, blk?.top_delays || []);
  });

  // KPI Best / Worst click
  ["kpiBestCard", "kpiWorstCard"].forEach((id) => {
    const el = $(id);
    const handler = () => {
      if (el.dataset.stationId) openStationModal(el.dataset.stationId);
    };
    el.addEventListener("click", handler);
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handler();
      }
    });
  });

  // Delegated clicks for station drilldown & modal close
  document.addEventListener("click", (e) => {
    const openBtn = e.target.closest("[data-open-station]");
    if (openBtn) {
      openStationModal(openBtn.dataset.openStation);
      return;
    }
    const closeBtn = e.target.closest("[data-close-modal]");
    if (closeBtn) {
      closeModal(closeBtn.dataset.closeModal);
      return;
    }
    if (e.target.classList.contains("modal-backdrop")) {
      closeModal(e.target.id);
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeModal("stationModal");
      closeModal("aboutModal");
    }
  });

  // Map tools (mobile scroll-lock toggle & reset view)
  $("btnMapRoam").addEventListener("click", () => {
    state.mapRoamEnabled = !state.mapRoamEnabled;
    syncMapToolsUI();
    renderTaiwanMap(state.activeStationRows, state.standard, openStationModal, state.mapRoamEnabled);
  });

  $("btnResetMap").addEventListener("click", () => {
    const effectiveRoam = isMobileViewport() ? state.mapRoamEnabled : true;
    renderTaiwanMap(state.activeStationRows, state.standard, openStationModal, effectiveRoam);
  });

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const nowMobile = isMobileViewport();
      if (nowMobile !== state.lastIsMobile) {
        state.lastIsMobile = nowMobile;
        renderAll();
      } else {
        resizeAllCharts();
      }
    }, 120);
  });
}

// 確保 defer 的 ECharts 載入完畢後啟動
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrap);
} else {
  bootstrap();
}
