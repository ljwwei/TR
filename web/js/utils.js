/**
 * 統計計算、格式化、智慧通勤洞察引擎與 CSV 匯出工具
 */

export const BUCKET_LABELS = ["準點 (0分)", "輕微 (1-5分)", "中度 (6-15分)", "重度 (16-30分)", "嚴重 (>30分)"];
export const BUCKET_COLORS = ["#059669", "#10B981", "#D97706", "#EA580C", "#DC2626"];
export const REGION_ORDER = ["北部", "中部", "南部", "東部"];

export function calcOntimeRate(obj, standard = "official") {
  if (!obj || !obj.total) return 0;
  const count = standard === "strict" ? obj.ontime_0 : obj.ontime_5;
  return (count / obj.total) * 100;
}

export function calcOntimeCount(obj, standard = "official") {
  if (!obj) return 0;
  return standard === "strict" ? (obj.ontime_0 || 0) : (obj.ontime_5 || 0);
}

export function calcAvgDelay(obj) {
  if (!obj || !obj.total) return 0;
  return (obj.delay_sum || 0) / obj.total;
}

export function calcDelayedOnlyAvg(summary) {
  if (!summary || !summary.delayed_gt0) return 0;
  return (summary.delay_sum_gt0 || summary.delay_sum || 0) / summary.delayed_gt0;
}

export function fmtPct(val, digits = 1) {
  if (!Number.isFinite(val)) return "--.-%";
  return `${val.toFixed(digits)}%`;
}

export function fmtNum(val) {
  if (!Number.isFinite(val)) return "--";
  return Math.round(val).toLocaleString("zh-TW");
}

export function fmtMin(val, digits = 1) {
  if (!Number.isFinite(val)) return "--";
  return val.toFixed(digits);
}

export function getRateColor(rate, standard = "official") {
  const t1 = standard === "strict" ? 78 : 92;
  const t2 = standard === "strict" ? 68 : 85;
  const t3 = standard === "strict" ? 58 : 75;
  if (rate >= t1) return "#059669";
  if (rate >= t2) return "#D97706";
  if (rate >= t3) return "#EA580C";
  return "#DC2626";
}

export function getRatePillClass(rate, standard = "official") {
  const t1 = standard === "strict" ? 78 : 92;
  const t2 = standard === "strict" ? 68 : 85;
  const t3 = standard === "strict" ? 58 : 75;
  if (rate >= t1) return "pill-good";
  if (rate >= t2) return "pill-amber";
  if (rate >= t3) return "pill-orange";
  return "pill-bad";
}

export function getGradeInfo(rate, standard = "official") {
  const tA = standard === "strict" ? 78 : 93;
  const tB = standard === "strict" ? 68 : 87;
  const tC = standard === "strict" ? 58 : 78;
  if (rate >= tA) return { label: "優良", cls: "pill-good" };
  if (rate >= tB) return { label: "穩定", cls: "pill-amber" };
  if (rate >= tC) return { label: "偏多延誤", cls: "pill-orange" };
  return { label: "高度延誤", cls: "pill-bad" };
}

export function formatIsoShort(isoStr) {
  if (!isoStr) return "--";
  return isoStr.replace("T", " ").slice(0, 16);
}

/**
 * 根據目前選擇的期間與條件，自動生成 3 條實用的通勤與營運洞察。
 */
export function buildCommuterInsights(scopeBlock, stationRows, standard) {
  const insights = [];
  if (!scopeBlock || !scopeBlock.summary || !scopeBlock.summary.total) {
    return [
      { type: "neutral", html: "本期尚無足夠觀測班次，待 TDX 排程採集累積後將自動產出分析洞察。" },
    ];
  }

  // 1. 最高風險尖峰時段
  const activeHours = (scopeBlock.hourly || []).filter((h) => h.total >= 5);
  if (activeHours.length) {
    const worstHour = [...activeHours].sort((a, b) => calcAvgDelay(b) - calcAvgDelay(a))[0];
    const bestHour = [...activeHours].sort((a, b) => calcAvgDelay(a) - calcAvgDelay(b))[0];
    const wAvg = calcAvgDelay(worstHour);
    const wRate = calcOntimeRate(worstHour, standard);
    insights.push({
      type: "warn",
      html: `<strong>尖峰延誤熱區：</strong>每日 <strong>${String(worstHour.h).padStart(2, "0")}:00–${String((worstHour.h + 1) % 24).padStart(2, "0")}:00</strong> 平均誤點達 <strong>${fmtMin(wAvg)} 分</strong>（準點率 ${fmtPct(wRate)}）；相對最順暢時段為 <strong>${String(bestHour.h).padStart(2, "0")}:00</strong>（平均 ${fmtMin(calcAvgDelay(bestHour))} 分）。`,
    });
  }

  // 2. 車種表現差距
  const typeEntries = Object.entries(scopeBlock.train_types || {})
    .filter(([, v]) => v.total >= 10)
    .map(([name, v]) => ({ name, rate: calcOntimeRate(v, standard), avg: calcAvgDelay(v), total: v.total }));
  if (typeEntries.length >= 2) {
    typeEntries.sort((a, b) => b.rate - a.rate);
    const bestT = typeEntries[0];
    const worstT = typeEntries[typeEntries.length - 1];
    insights.push({
      type: "good",
      html: `<strong>車種穩定度對比：</strong><strong>${bestT.name}</strong> 表現最佳（準點率 <strong>${fmtPct(bestT.rate)}</strong>、均延誤 ${fmtMin(bestT.avg)} 分）；<strong>${worstT.name}</strong> 較易累積延誤（準點率 <strong>${fmtPct(worstT.rate)}</strong>、均延誤 ${fmtMin(worstT.avg)} 分）。`,
    });
  }

  // 3. 順逆行差異或重度誤點比例
  const d0 = scopeBlock.directions?.["0"];
  const d1 = scopeBlock.directions?.["1"];
  if (d0?.total && d1?.total) {
    const avg0 = calcAvgDelay(d0);
    const avg1 = calcAvgDelay(d1);
    const diff = Math.abs(avg1 - avg0);
    const heavier = avg1 >= avg0 ? "逆行（南下／往高雄臺東）" : "順行（北上／往臺北）";
    const severeCount = (scopeBlock.summary.buckets?.[3] || 0) + (scopeBlock.summary.buckets?.[4] || 0);
    const severePct = (severeCount / scopeBlock.summary.total) * 100;
    insights.push({
      type: "neutral",
      html: `<strong>行車方向與重度延誤：</strong><strong>${heavier}</strong> 平均多延誤 <strong>${fmtMin(diff)} 分</strong>；本期誤點超過 15 分鐘之重度班次共 <strong>${fmtNum(severeCount)}</strong> 班次（佔全體 <strong>${fmtPct(severePct, 2)}</strong>）。`,
    });
  } else if (stationRows.length) {
    const worst = [...stationRows].sort((a, b) => b.avgDelay - a.avgDelay)[0];
    insights.push({
      type: "warn",
      html: `<strong>車站關注焦點：</strong><strong>${worst.name}站</strong>（${worst.city}）本期平均延誤 ${fmtMin(worst.avgDelay)} 分，建議轉乘預留緩衝時間。`,
    });
  }

  return insights;
}

/**
 * 將目前檢視之各站統計表匯出為 UTF-8 BOM CSV（Excel 開啟中文不亂碼）
 */
export function exportStationsCsv(rows, periodLabel, scopeLabel) {
  const headers = [
    "車站代碼",
    "車站名稱",
    "縣市",
    "區域",
    "路線",
    "本島縣市代表站",
    "觀測總班次",
    "準點班次(<=5分)",
    "準點率(<=5分)%",
    "嚴格準點班次(0分)",
    "嚴格準點率(0分)%",
    "平均誤點(分)",
    "最大誤點(分)",
    "誤點超過5分班次",
  ];
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(
      [
        `"${r.id}"`,
        `"${r.name}"`,
        `"${r.city}"`,
        `"${r.region}"`,
        `"${r.line}"`,
        r.isMajor ? "是" : "否",
        r.total,
        r.ontime_5,
        r.rate5.toFixed(2),
        r.ontime_0,
        r.rate0.toFixed(2),
        r.avgDelay.toFixed(2),
        r.max_delay,
        r.delayed_gt5,
      ].join(",")
    );
  }
  const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `TRA_準誤點統計_${periodLabel.replace(/\s+/g, "")}_${scopeLabel}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
