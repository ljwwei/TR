/**
 * Apache ECharts 視覺化模組：
 * 1. 台灣鐵路準誤點互動地圖（Geo + 環島幹線路網 + 車站氣泡）
 * 2. 時間軸雙軸趨勢圖（單日 24H / 單月每日 / 單年每月，支援點擊下鑽！）
 * 3. 誤點分鐘數分佈環形圖
 * 4. 各車種準誤點評比複合圖
 * 5. 區域 × 時段誤點熱力圖
 * 6. 四大區域準點對比水平長條圖
 * 7. 單站深度分析彈窗圖表（24H 曲線 + 車種對比）
 */

import { TAIWAN_GEOJSON, TRA_RAIL_CORRIDORS } from "./taiwan-geo.js";
import {
  BUCKET_COLORS,
  BUCKET_LABELS,
  REGION_ORDER,
  calcAvgDelay,
  calcOntimeRate,
  fmtMin,
  fmtNum,
  fmtPct,
  getRateColor,
} from "./utils.js";

let mapRegistered = false;
const chartRegistry = new Map();

export function isMobileViewport() {
  return window.innerWidth <= 768;
}

function getThemeColors() {
  const dark = document.documentElement.getAttribute("data-theme") === "dark";
  return {
    dark,
    text: dark ? "#E2E8F0" : "#1E293B",
    muted: dark ? "#94A3B8" : "#64748B",
    gridLine: dark ? "rgba(148, 163, 184, 0.14)" : "rgba(15, 23, 42, 0.08)",
    tooltipBg: dark ? "rgba(15, 23, 42, 0.96)" : "rgba(255, 255, 255, 0.98)",
    tooltipBorder: dark ? "#334155" : "#CBD5E1",
    mapArea: dark ? "#16263F" : "#E8EEF7",
    mapBorder: dark ? "#3B5982" : "#94A3B8",
    mapHover: dark ? "#1F3557" : "#DCE7F7",
    railLine: dark ? "rgba(125, 211, 252, 0.36)" : "rgba(15, 41, 74, 0.28)",
    barBlue: dark ? "#38BDF8" : "#1D4ED8",
    barSlate: dark ? "rgba(148, 163, 184, 0.25)" : "rgba(15, 41, 74, 0.12)",
  };
}

function getOrInitChart(domId) {
  if (typeof window.echarts === "undefined") return null;
  if (!mapRegistered) {
    window.echarts.registerMap("taiwan_main", TAIWAN_GEOJSON);
    mapRegistered = true;
  }
  const el = document.getElementById(domId);
  if (!el) return null;
  let inst = chartRegistry.get(domId);
  if (!inst || inst.isDisposed()) {
    inst = window.echarts.init(el);
    chartRegistry.set(domId, inst);
  }
  return inst;
}

export function resizeAllCharts() {
  for (const inst of chartRegistry.values()) {
    if (inst && !inst.isDisposed()) inst.resize();
  }
}

export function renderTaiwanMap(stationRows, standard, onStationClick, mapRoam = null) {
  const chart = getOrInitChart("chartTaiwanMap");
  if (!chart) return;
  const tc = getThemeColors();
  const mobile = isMobileViewport();
  const allowRoam = mapRoam !== null ? mapRoam : !mobile;

  const validRows = stationRows.filter((s) => Number.isFinite(s.lon) && Number.isFinite(s.lat));
  const maxTotal = Math.max(1, ...validRows.map((s) => s.total));

  const scatterData = validRows.map((s) => {
    const rate = standard === "strict" ? s.rate0 : s.rate5;
    const baseSize = mobile ? (s.isMajor ? 9 : 6) : (s.isMajor ? 11 : 7);
    const scaleSize = mobile ? (s.isMajor ? 10 : 7) : (s.isMajor ? 14 : 9);
    const size = baseSize + Math.sqrt(s.total / maxTotal) * scaleSize;
    return {
      name: s.name,
      stationId: s.id,
      value: [s.lon, s.lat, rate, s.avgDelay, s.total],
      symbolSize: size,
      itemStyle: {
        color: getRateColor(rate, standard),
        borderColor: tc.dark ? "#0B1220" : "#FFFFFF",
        borderWidth: s.isMajor ? 2 : 1.2,
        shadowBlur: s.isMajor ? 7 : 3,
        shadowColor: "rgba(15, 23, 42, 0.28)",
      },
      label: {
        show: s.isMajor && validRows.length <= 25 && (!mobile || ["1000", "3300", "4220", "4400", "7000", "6000", "7190", "1210", "4080"].includes(s.id)),
        formatter: s.name,
        position: s.lon > 121.35 && s.lat < 24.9 ? "right" : s.lat > 25.06 ? "top" : "left",
        distance: mobile ? 4 : 6,
        color: tc.text,
        fontSize: mobile ? 10 : 11,
        fontWeight: 600,
        backgroundColor: tc.dark ? "rgba(16, 27, 46, 0.78)" : "rgba(255, 255, 255, 0.84)",
        padding: [2, 4],
        borderRadius: 4,
      },
      meta: s,
    };
  });

  chart.setOption(
    {
      tooltip: {
        trigger: "item",
        confine: true,
        backgroundColor: tc.tooltipBg,
        borderColor: tc.tooltipBorder,
        textStyle: { color: tc.text, fontFamily: "Noto Sans TC, sans-serif", fontSize: 12 },
        formatter: (params) => {
          const s = params.data?.meta;
          if (!s) return "";
          const rate = standard === "strict" ? s.rate0 : s.rate5;
          const stdLabel = standard === "strict" ? "嚴格準點 (0分)" : "官方準點 (≤5分)";
          return `
            <div style="min-width:170px">
              <div style="font-weight:700;font-size:13px;margin-bottom:4px">${s.name}車站 <span style="font-weight:400;opacity:.75">${s.city}</span></div>
              <div style="font-size:11px;opacity:.75;margin-bottom:6px">${s.line}・代碼 ${s.id}</div>
              <div style="display:flex;justify-content:space-between;gap:12px"><span>${stdLabel}</span><strong style="color:${getRateColor(rate, standard)}">${fmtPct(rate)}</strong></div>
              <div style="display:flex;justify-content:space-between;gap:12px"><span>平均誤點</span><strong>${fmtMin(s.avgDelay)} 分</strong></div>
              <div style="display:flex;justify-content:space-between;gap:12px"><span>最大誤點</span><strong>${s.max_delay} 分</strong></div>
              <div style="display:flex;justify-content:space-between;gap:12px"><span>統計班次</span><strong>${fmtNum(s.total)} 班</strong></div>
              <div style="margin-top:6px;font-size:11px;color:#3B82F6">點擊節點開啟單站詳細分析 →</div>
            </div>
          `;
        },
      },
      geo: {
        map: "taiwan_main",
        roam: allowRoam,
        zoom: mobile ? 1.12 : 1.18,
        center: [120.96, 23.62],
        scaleLimit: { min: 0.9, max: 5 },
        itemStyle: {
          areaColor: tc.mapArea,
          borderColor: tc.mapBorder,
          borderWidth: 1.3,
        },
        emphasis: {
          itemStyle: { areaColor: tc.mapHover },
          label: { show: false },
        },
      },
      series: [
        {
          name: "臺鐵幹線路網",
          type: "lines",
          coordinateSystem: "geo",
          polyline: true,
          silent: true,
          zlevel: 1,
          lineStyle: {
            color: tc.railLine,
            width: mobile ? 1.8 : 2.2,
            type: "solid",
          },
          data: TRA_RAIL_CORRIDORS,
        },
        {
          name: "車站準點率",
          type: "scatter",
          coordinateSystem: "geo",
          zlevel: 2,
          data: scatterData,
          emphasis: {
            scale: 1.35,
            label: { show: true },
          },
        },
      ],
    },
    true
  );

  chart.off("click");
  chart.on("click", (params) => {
    if (params.data?.stationId && typeof onStationClick === "function") {
      onStationClick(params.data.stationId);
    }
  });
}

export function renderTrendChart(trend, granularity, standard, onDrillPeriod) {
  const chart = getOrInitChart("chartTrend");
  if (!chart) return;
  const tc = getThemeColors();
  const mobile = isMobileViewport();

  const labels = trend.map((t) => (mobile ? t.label.replace("時", "") : t.label));
  const rates = trend.map((t) => (t.total > 0 ? Number(calcOntimeRate(t, standard).toFixed(2)) : null));
  const avgDelays = trend.map((t) => (t.total > 0 ? Number(calcAvgDelay(t).toFixed(2)) : null));
  const totals = trend.map((t) => t.total);

  const validRates = rates.filter((v) => v !== null);
  const minRate = validRates.length ? Math.max(0, Math.floor((Math.min(...validRates, 80) - 6) / 5) * 5) : 0;

  chart.setOption(
    {
      tooltip: {
        trigger: "axis",
        confine: true,
        backgroundColor: tc.tooltipBg,
        borderColor: tc.tooltipBorder,
        textStyle: { color: tc.text, fontSize: 12 },
        formatter: (items) => {
          if (!items.length) return "";
          const idx = items[0].dataIndex;
          const row = trend[idx];
          if (!row || !row.total) {
            return `<div><div style="font-weight:700;margin-bottom:4px">${row?.label || ""}</div><div style="opacity:.75">此時段尚無觀測班次</div></div>`;
          }
          const clickableHint =
            granularity === "monthly"
              ? `<div style="margin-top:5px;font-size:11px;color:#3B82F6">點擊可切換至 ${row.key} 單日分析 →</div>`
              : granularity === "yearly"
              ? `<div style="margin-top:5px;font-size:11px;color:#3B82F6">點擊可切換至 ${row.key} 單月分析 →</div>`
              : "";
          return `
            <div>
              <div style="font-weight:700;margin-bottom:4px">${row.label}${row.key && row.key !== row.label ? ` (${row.key})` : ""}</div>
              <div>準點率：<strong>${fmtPct(rates[idx])}</strong></div>
              <div>平均誤點：<strong>${fmtMin(avgDelays[idx])} 分</strong></div>
              <div>統計班次：<strong>${fmtNum(totals[idx])} 班</strong></div>
              ${row.max_delay ? `<div>最大誤點：<strong>${row.max_delay} 分</strong></div>` : ""}
              ${clickableHint}
            </div>
          `;
        },
      },
      legend: {
        top: 0,
        right: mobile ? "center" : 8,
        textStyle: { color: tc.muted, fontSize: mobile ? 11 : 12 },
      },
      grid: { left: mobile ? 42 : 54, right: mobile ? 36 : 56, top: mobile ? 42 : 40, bottom: 28 },
      xAxis: {
        type: "category",
        data: labels,
        axisLine: { lineStyle: { color: tc.gridLine } },
        axisLabel: { color: tc.muted, fontSize: mobile ? 10 : 11, hideOverlap: true },
      },
      yAxis: [
        {
          type: "value",
          name: mobile ? "%" : "準點率 (%)",
          min: minRate,
          max: 100,
          nameTextStyle: { color: tc.muted, fontSize: 11 },
          axisLabel: { color: tc.muted, fontSize: mobile ? 10 : 11, formatter: "{value}%" },
          splitLine: { lineStyle: { color: tc.gridLine } },
        },
        {
          type: "value",
          name: mobile ? "分" : "平均誤點 (分)",
          min: 0,
          nameTextStyle: { color: tc.muted, fontSize: 11 },
          axisLabel: { color: tc.muted, fontSize: mobile ? 10 : 11, formatter: "{value}分" },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: "平均誤點(分)",
          type: "bar",
          yAxisIndex: 1,
          barMaxWidth: 24,
          itemStyle: {
            borderRadius: [5, 5, 0, 0],
            color: tc.dark ? "rgba(251, 146, 60, 0.58)" : "rgba(234, 88, 12, 0.28)",
          },
          data: avgDelays,
        },
        {
          name: "準點率(%)",
          type: "line",
          yAxisIndex: 0,
          smooth: 0.28,
          symbol: "circle",
          symbolSize: 7,
          lineStyle: { width: 3, color: "#059669" },
          itemStyle: { color: "#059669", borderColor: "#fff", borderWidth: 1.5 },
          areaStyle: {
            color: new window.echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: "rgba(5, 150, 105, 0.22)" },
              { offset: 1, color: "rgba(5, 150, 105, 0.01)" },
            ]),
          },
          data: rates,
        },
      ],
    },
    true
  );

  chart.off("click");
  chart.on("click", (params) => {
    const row = trend[params.dataIndex];
    if (row && typeof onDrillPeriod === "function" && (granularity === "monthly" || granularity === "yearly")) {
      onDrillPeriod(row.key);
    }
  });
}

export function renderDelayDistChart(summary) {
  const chart = getOrInitChart("chartDelayDist");
  if (!chart) return;
  const tc = getThemeColors();
  const mobile = isMobileViewport();
  const buckets = summary?.buckets || [0, 0, 0, 0, 0];
  const total = summary?.total || 1;

  const data = BUCKET_LABELS.map((name, idx) => ({
    name,
    value: buckets[idx] || 0,
    itemStyle: { color: BUCKET_COLORS[idx] },
  }));

  chart.setOption(
    {
      tooltip: {
        trigger: "item",
        confine: true,
        backgroundColor: tc.tooltipBg,
        borderColor: tc.tooltipBorder,
        textStyle: { color: tc.text, fontSize: 12 },
        formatter: (p) => `<strong>${p.name}</strong><br/>班次數：${fmtNum(p.value)}（${((p.value / total) * 100).toFixed(1)}%）`,
      },
      legend: {
        show: !mobile,
        orient: "vertical",
        right: 8,
        top: "middle",
        textStyle: { color: tc.muted, fontSize: 12 },
      },
      series: [
        {
          name: "誤點分佈",
          type: "pie",
          radius: mobile ? ["50%", "80%"] : ["48%", "76%"],
          center: mobile ? ["50%", "50%"] : ["36%", "50%"],
          avoidLabelOverlap: true,
          itemStyle: {
            borderRadius: 6,
            borderColor: tc.dark ? "#101B2E" : "#FFFFFF",
            borderWidth: 2,
          },
          label: { show: false },
          emphasis: {
            label: {
              show: true,
              fontSize: 13,
              fontWeight: 700,
              color: tc.text,
              formatter: "{d}%",
            },
          },
          data,
        },
      ],
    },
    true
  );
}

export function renderTrainTypesChart(trainTypesObj, standard) {
  const chart = getOrInitChart("chartTrainTypes");
  if (!chart) return;
  const tc = getThemeColors();
  const mobile = isMobileViewport();

  const entries = Object.entries(trainTypesObj || {})
    .filter(([, v]) => v.total > 0)
    .map(([name, v]) => ({
      name,
      rate: Number(calcOntimeRate(v, standard).toFixed(1)),
      avg: Number(calcAvgDelay(v).toFixed(2)),
      total: v.total,
    }))
    .sort((a, b) => b.total - a.total);

  chart.setOption(
    {
      tooltip: {
        trigger: "axis",
        confine: true,
        axisPointer: { type: "shadow" },
        backgroundColor: tc.tooltipBg,
        borderColor: tc.tooltipBorder,
        textStyle: { color: tc.text, fontSize: 12 },
        formatter: (items) => {
          const idx = items[0]?.dataIndex;
          const e = entries[idx];
          if (!e) return "";
          return `
            <div>
              <div style="font-weight:700;margin-bottom:4px">${e.name}</div>
              <div>準點率：<strong>${fmtPct(e.rate)}</strong></div>
              <div>平均誤點：<strong>${fmtMin(e.avg)} 分</strong></div>
              <div>觀測班次：<strong>${fmtNum(e.total)} 班</strong></div>
            </div>
          `;
        },
      },
      legend: { top: 0, right: mobile ? "center" : 6, textStyle: { color: tc.muted, fontSize: mobile ? 11 : 12 } },
      grid: { left: mobile ? 40 : 48, right: mobile ? 36 : 48, top: 36, bottom: mobile ? 54 : 42 },
      xAxis: {
        type: "category",
        data: entries.map((e) => e.name),
        axisLine: { lineStyle: { color: tc.gridLine } },
        axisLabel: { color: tc.muted, fontSize: mobile ? 10 : 11, interval: 0, rotate: mobile ? 28 : (entries.length > 5 ? 18 : 0) },
      },
      yAxis: [
        {
          type: "value",
          min: 0,
          max: 100,
          axisLabel: { color: tc.muted, fontSize: mobile ? 10 : 11, formatter: "{value}%" },
          splitLine: { lineStyle: { color: tc.gridLine } },
        },
        {
          type: "value",
          min: 0,
          axisLabel: { color: tc.muted, fontSize: mobile ? 10 : 11, formatter: "{value}分" },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: "準點率(%)",
          type: "bar",
          barMaxWidth: mobile ? 20 : 26,
          itemStyle: {
            borderRadius: [6, 6, 0, 0],
            color: (params) => getRateColor(entries[params.dataIndex].rate, standard),
          },
          data: entries.map((e) => e.rate),
        },
        {
          name: "平均誤點(分)",
          type: "line",
          yAxisIndex: 1,
          smooth: true,
          symbolSize: 7,
          lineStyle: { color: "#F59E0B", width: 2.5 },
          itemStyle: { color: "#F59E0B" },
          data: entries.map((e) => e.avg),
        },
      ],
    },
    true
  );
}

export function renderHeatmapChart(regionHourMatrix) {
  const chart = getOrInitChart("chartHeatmap");
  if (!chart) return;
  const tc = getThemeColors();
  const mobile = isMobileViewport();

  const hours = [];
  for (let h = 5; h <= 23; h++) hours.push(h);

  const data = [];
  let maxAvg = 4;
  REGION_ORDER.forEach((reg, yIdx) => {
    const arr = regionHourMatrix?.[reg] || [];
    hours.forEach((hr, xIdx) => {
      const cell = arr[hr] || [0, 0];
      const avg = cell[0] > 0 ? Number((cell[1] / cell[0]).toFixed(1)) : 0;
      if (avg > maxAvg) maxAvg = avg;
      data.push([xIdx, yIdx, avg, cell[0]]);
    });
  });

  chart.setOption(
    {
      tooltip: {
        position: "top",
        confine: true,
        backgroundColor: tc.tooltipBg,
        borderColor: tc.tooltipBorder,
        textStyle: { color: tc.text, fontSize: 12 },
        formatter: (p) => {
          const [xIdx, yIdx, avg, cnt] = p.data;
          if (!cnt) return `<strong>${REGION_ORDER[yIdx]}幹線・${String(hours[xIdx]).padStart(2, "0")}:00</strong><br/>尚無觀測班次`;
          return `<strong>${REGION_ORDER[yIdx]}幹線・${String(hours[xIdx]).padStart(2, "0")}:00</strong><br/>平均誤點：<strong>${avg.toFixed(1)} 分</strong><br/>統計班次：${fmtNum(cnt)} 班`;
        },
      },
      grid: { left: mobile ? 42 : 54, right: mobile ? 8 : 16, top: 12, bottom: 52 },
      xAxis: {
        type: "category",
        data: hours.map((h) => (mobile ? String(h).padStart(2, "0") : `${String(h).padStart(2, "0")}時`)),
        splitArea: { show: true },
        axisLabel: { color: tc.muted, fontSize: 10, interval: mobile ? 1 : 0 },
      },
      yAxis: {
        type: "category",
        data: REGION_ORDER,
        splitArea: { show: true },
        axisLabel: { color: tc.text, fontWeight: 600, fontSize: mobile ? 11 : 12 },
      },
      visualMap: {
        min: 0,
        max: Math.max(5, Math.ceil(maxAvg)),
        calculable: false,
        orient: "horizontal",
        left: "center",
        bottom: 0,
        itemWidth: 11,
        itemHeight: mobile ? 84 : 110,
        text: ["高延誤(分)", "低延誤"],
        textStyle: { color: tc.muted, fontSize: 11 },
        inRange: {
          color: tc.dark
            ? ["#0F2E28", "#059669", "#D97706", "#EA580C", "#DC2626"]
            : ["#ECFDF5", "#A7F3D0", "#FDE68A", "#FDBA74", "#EF4444"],
        },
      },
      series: [
        {
          name: "平均誤點",
          type: "heatmap",
          data,
          label: {
            show: !mobile,
            fontSize: 10,
            color: tc.dark ? "#F8FAFC" : "#0F172A",
            formatter: (p) => (p.data[3] > 0 ? p.data[2].toFixed(1) : ""),
          },
          emphasis: {
            itemStyle: { shadowBlur: 8, shadowColor: "rgba(0,0,0,0.35)" },
          },
        },
      ],
    },
    true
  );
}

export function renderRegionsChart(regionsObj, standard) {
  const chart = getOrInitChart("chartRegions");
  if (!chart) return;
  const tc = getThemeColors();

  const rows = REGION_ORDER.map((r) => {
    const v = regionsObj?.[r] || { total: 0, ontime_0: 0, ontime_5: 0, delay_sum: 0 };
    return {
      name: `${r}幹線`,
      rate: v.total > 0 ? Number(calcOntimeRate(v, standard).toFixed(1)) : null,
      avg: v.total > 0 ? Number(calcAvgDelay(v).toFixed(2)) : 0,
      total: v.total,
    };
  });

  chart.setOption(
    {
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        backgroundColor: tc.tooltipBg,
        borderColor: tc.tooltipBorder,
        textStyle: { color: tc.text, fontSize: 12 },
        formatter: (items) => {
          const r = rows[items[0]?.dataIndex];
          if (!r) return "";
          if (!r.total) return `<strong>${r.name}</strong><br/>本期尚無觀測班次`;
          return `<strong>${r.name}</strong><br/>準點率：${fmtPct(r.rate)}<br/>平均誤點：${fmtMin(r.avg)} 分<br/>班次：${fmtNum(r.total)}`;
        },
      },
      grid: { left: 72, right: 52, top: 8, bottom: 24 },
      xAxis: {
        type: "value",
        min: 0,
        max: 100,
        axisLabel: { color: tc.muted, formatter: "{value}%" },
        splitLine: { lineStyle: { color: tc.gridLine } },
      },
      yAxis: {
        type: "category",
        inverse: true,
        data: rows.map((r) => r.name),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: tc.text, fontWeight: 600, fontSize: 12 },
      },
      series: [
        {
          type: "bar",
          barWidth: 16,
          showBackground: true,
          backgroundStyle: { color: tc.barSlate, borderRadius: 6 },
          itemStyle: {
            borderRadius: 6,
            color: (p) => (rows[p.dataIndex].rate === null ? tc.barSlate : getRateColor(rows[p.dataIndex].rate, standard)),
          },
          label: {
            show: true,
            position: "right",
            color: tc.text,
            fontFamily: "JetBrains Mono, monospace",
            fontSize: 11,
            formatter: (p) => (rows[p.dataIndex].rate === null ? "無資料" : `${rows[p.dataIndex].rate.toFixed(1)}%`),
          },
          data: rows.map((r) => r.rate),
        },
      ],
    },
    true
  );
}

export function renderStationDrilldownCharts(stStats, standard) {
  const tc = getThemeColors();

  // 1) Station Hourly Chart
  const cHourly = getOrInitChart("chartStationHourly");
  if (cHourly) {
    const hrs = [];
    const rates = [];
    const avgs = [];
    for (let h = 5; h <= 23; h++) {
      const tup = stStats.hourly?.[h] || [0, 0, 0, 0];
      const [tot, o0, o5, dsum] = tup;
      hrs.push(`${String(h).padStart(2, "0")}時`);
      rates.push(tot > 0 ? Number((((standard === "strict" ? o0 : o5) / tot) * 100).toFixed(1)) : null);
      avgs.push(tot > 0 ? Number((dsum / tot).toFixed(1)) : 0);
    }
    cHourly.setOption(
      {
        tooltip: {
          trigger: "axis",
          backgroundColor: tc.tooltipBg,
          borderColor: tc.tooltipBorder,
          textStyle: { color: tc.text, fontSize: 12 },
        },
        grid: { left: 46, right: 44, top: 28, bottom: 28 },
        xAxis: { type: "category", data: hrs, axisLabel: { color: tc.muted, fontSize: 10 } },
        yAxis: [
          { type: "value", min: 0, max: 100, axisLabel: { color: tc.muted, formatter: "{value}%" }, splitLine: { lineStyle: { color: tc.gridLine } } },
          { type: "value", min: 0, axisLabel: { color: tc.muted, formatter: "{value}分" }, splitLine: { show: false } },
        ],
        series: [
          { name: "平均誤點(分)", type: "bar", yAxisIndex: 1, itemStyle: { color: "rgba(234, 88, 12, 0.4)", borderRadius: [4, 4, 0, 0] }, data: avgs },
          { name: "準點率(%)", type: "line", smooth: true, connectNulls: true, lineStyle: { color: "#059669", width: 2.5 }, itemStyle: { color: "#059669" }, data: rates },
        ],
      },
      true
    );
  }

  // 2) Station Train Types Chart
  const cTypes = getOrInitChart("chartStationTypes");
  if (cTypes) {
    const rows = Object.entries(stStats.train_types || {})
      .filter(([, t]) => t[0] > 0)
      .map(([name, [tot, o0, o5, dsum]]) => ({
        name,
        tot,
        rate: Number((((standard === "strict" ? o0 : o5) / tot) * 100).toFixed(1)),
        avg: Number((dsum / tot).toFixed(1)),
      }))
      .sort((a, b) => b.tot - a.tot);

    cTypes.setOption(
      {
        tooltip: {
          trigger: "axis",
          axisPointer: { type: "shadow" },
          backgroundColor: tc.tooltipBg,
          borderColor: tc.tooltipBorder,
          textStyle: { color: tc.text, fontSize: 12 },
          formatter: (items) => {
            const r = rows[items[0]?.dataIndex];
            if (!r) return "";
            return `<strong>${r.name}</strong><br/>準點率：${fmtPct(r.rate)}<br/>平均誤點：${fmtMin(r.avg)} 分<br/>班次：${fmtNum(r.tot)}`;
          },
        },
        grid: { left: 84, right: 48, top: 14, bottom: 24 },
        xAxis: { type: "value", min: 0, max: 100, axisLabel: { color: tc.muted, formatter: "{value}%" }, splitLine: { lineStyle: { color: tc.gridLine } } },
        yAxis: { type: "category", inverse: true, data: rows.map((r) => r.name), axisLabel: { color: tc.text, fontSize: 11 } },
        series: [
          {
            type: "bar",
            barMaxWidth: 20,
            itemStyle: {
              borderRadius: [0, 5, 5, 0],
              color: (p) => getRateColor(rows[p.dataIndex].rate, standard),
            },
            label: { show: true, position: "right", color: tc.text, fontSize: 11, formatter: (p) => `${rows[p.dataIndex].rate.toFixed(1)}%` },
            data: rows.map((r) => r.rate),
          },
        ],
      },
      true
    );
  }
}
