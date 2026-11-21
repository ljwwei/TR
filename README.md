# 🚆 台鐵準誤點分析統計儀表板（TRA Punctuality Analytics）

以交通部 **TDX 運輸資料流通服務平臺（臺鐵 TRA v3 API）** 為資料來源，採用 **GitHub Actions 定時採集 + 靜態 JSON 快取 + GitHub Pages 全球 CDN** 架構打造的台鐵準誤點多維視覺化分析網站。

> **核心特色：多人同時瀏覽本網站「完全不會」增加 TDX API 讀取次數或流量點數！**

---

## ✨ 主要功能亮點

- **單日／單月／單年三尺度切換**：
  - **單日**：24 小時（05:00–23:59）尖離峰準誤點雙軸趨勢。
  - **單月**：每日準點率與平均誤點波動，點擊圖表任意日期可直接下鑽單日分析。
  - **單年**：1–12 月季節性趨勢比較，點擊任意月份可直接下鑽單月分析。
- **本島 19 縣市主要車站 ⇄ 全臺所有車站即時切換**：
  - 預設聚焦台灣本島 19 縣市代表車站（基隆、臺北、板橋、桃園、竹北、新竹、苗栗、臺中、彰化、濁水、斗六、民雄、嘉義、臺南、高雄、屏東、臺東、花蓮、宜蘭）。
  - 採集端預設以單次壓縮請求涵蓋**全臺所有車站（240+ 站）**，前端可一鍵展開全站檢視與搜尋。
- **雙準點標準即時重算**：支援切換 **「臺鐵官方標準（≤ 5 分鐘）」** 與 **「嚴格準點（0 分鐘）」**，所有 KPI、地圖色階、排行榜與圖表即時重算。
- **豐富視覺化與通勤實用資訊**：
  - 互動式**台灣鐵路環島準誤點地圖**（點擊任意車站立即開啟單站 24H 與車種深度分析彈窗）。
  - **本期智慧通勤洞察**（自動歸納最易誤點尖峰時段、最穩定車種、順逆行差異與重度誤點比例）。
  - **誤點分鐘數分佈**（0分／1–5分／6–15分／16–30分／>30分）、**各車種評比**（新自強 EMU3000、普悠瑪、太魯閣、自強、莒光、區間快、區間車）、**區域 × 時段誤點熱力圖**、**順行 vs 逆行對比**、**高誤點焦點班次追蹤**與 **UTF-8 CSV 報表匯出**。
  - 內建 **淺色／深色夜間行控模式** 與 **本月 TDX API 點數額度監控面板**。

---

## 🏗️ 零 API 增量靜態架構與點數估算

```text
TDX API v3 (StationLiveBoard + Station)
   ▲  全天候 24 小時每 30 分鐘由 GitHub Actions 執行 1 次壓縮呼叫（含跨夜與延誤班次）
   │  全月 1,440 次呼叫（~1.7–2.1 點），內建 2.75 點自動熔斷保護
GitHub Actions (collect-tdx.yml)
   │  去重彙整為 daily / monthly / yearly 靜態 JSON → 推送至獨立 tdx-data 分支
GitHub Actions (deploy-pages.yml)
   ▼  合併 main 網頁與 tdx-data 靜態數據 → 自動部署至 GitHub Pages
萬人瀏覽網頁 ──► 僅讀取 CDN 靜態 JSON（TDX API 額外消耗 = 0 次！）
```

| 採集範圍（`COLLECT_SCOPE`） | 每日呼叫（24 小時全天候） | 每月預估呼叫 | 每月預估流量 | 預估耗點（免費基礎會員 3 點／月） |
| :--- | :---: | :---: | :---: | :---: |
| `all`（預設：全臺 245 車站） | 48 次 | 1,440 次 | ~110–170 MB | **約 1.7 – 2.1 點** |
| `major`（僅本島 19 縣市主站） | 48 次 | 1,440 次 | ~25–40 MB | **約 1.1 – 1.2 點** |

---

## 🚀 2 分鐘啟用自動採集與部署

1. **設定 TDX API 金鑰（GitHub Secrets）**
   - 前往本專案的 **Settings → Secrets and variables → Actions → Secrets**。
   - 新增以下兩組 Repository Secrets（來自 [TDX 會員中心](https://tdx.transportdata.tw/) 建立的應用程式）：
     - `TDX_CLIENT_ID`
     - `TDX_CLIENT_SECRET`
   - *(選用)* 若想切換為極省流模式或調整熔斷點數，可在 **Variables** 分頁新增：
     - `COLLECT_SCOPE`：`all`（預設）或 `major`
     - `MAX_MONTHLY_POINTS`：`2.75`（基礎會員免費 3 點安全上限；若為付費銅級以上會員可調高，例如 `180`）

2. **開啟 GitHub Pages**
   - 前往 **Settings → Pages**。
   - 將 **Build and deployment → Source** 改為 **GitHub Actions**。

3. **立即觸發首次即時採集**
   - 前往 **Actions → Collect TDX TRA Punctuality Data → Run workflow**。
   - 執行完成後，系統會自動建立 `tdx-data` 資料分支並重新部署網站，開啟 `https://ljwwei.github.io/TR/` 即可看到自動切換為 **「TDX 真實即時累積」**！

---

## ⏰ Cloudflare Worker 準點排程設定（解決 GitHub Actions cron 延遲）

GitHub Actions 內建 `schedule` 在尖峰時段常延遲 15–45 分鐘甚至略過，本專案已內附免費的 **Cloudflare Worker 準點排程器**（[cloudflare-cron/worker.js](cloudflare-cron/worker.js)），無須綁信用卡即可每 30 分鐘準秒觸發採集（同時保留 GitHub 每 2 小時備援防呆，20 分鐘內不重複扣點）：

1. **建立最小權限 GitHub Token（Fine-grained PAT）**
   - 前往 GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**。
   - **Repository access** 選 **Only select repositories → `ljwwei/TR`**。
   - **Repository permissions** 僅需將 **Actions** 改為 **Read and write**（其餘全部 No access），產生後複製 Token。
2. **建立 Cloudflare Worker（免裝 CLI，網頁 60 秒完成）**
   - 登入 [Cloudflare Dashboard](https://dash.cloudflare.com/) → 左側 **Compute (Workers) → Workers & Pages → Create → Create Worker**（命名如 `tra-tdx-cron`）→ **Deploy**。
   - 點選 **Edit code**，將本專案 `cloudflare-cron/worker.js` 完整內容貼上取代預設程式碼並按 **Deploy**。
3. **加入 Secret 與 Cron Trigger**
   - 進入該 Worker 的 **Settings → Variables and Secrets → Add** → Type 選 **Secret**，Name 填 `GITHUB_PAT`，Value 貼上步驟 1 的 Token → **Deploy**。
   - 進入 **Settings → Trigger Events → Cron Triggers → Add Cron Trigger**，填入 `0,30 * * * *`（每小時 `:00` 與 `:30` 準時執行）→ **Add Trigger**。
   - 開啟 Worker 網址確認畫面顯示 `"github_pat_configured": true` 即大功告成！

---

## 📂 補匯入 TDX 歷史資料（選用）

因 TDX 即時 API 不提供過去歷史日期查詢，若您有透過 TDX 會員中心「歷史服務」申請下載過往的臺鐵 CSV / JSON 檔案，可用內建工具批次匯入並自動合併至單日／單月／單年統計：

```bash
python scripts/import_historical.py --input path/to/tdx_history.json --data-dir web/data/live
```
