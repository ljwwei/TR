#!/usr/bin/env python3
"""
TDX 運輸資料流通服務平臺 — 臺鐵準誤點定時採集與多維彙整腳本（純 Python 標準函式庫，無需額外套件）

運作原理：
1. 以 OAuth 2.0 Client Credentials 取得 TDX Access Token。
2. 每週自動更新一次全臺車站清單（v3/Rail/TRA/Station）。
3. 單次壓縮請求抓取全臺即時車站到離站電子看板（v3/Rail/TRA/StationLiveBoard），
   若遇到伺服器限制或使用者設定 COLLECT_SCOPE=major，則自動切換為本島 19 縣市主要車站精簡過濾。
4. 依據 (ServiceDate, StationID, TrainNo, ScheduleTime) 去重，保留最接近實際離站的最新誤點秒/分鐘數。
5. 自動產製單日（daily）、單月（monthly）、單年（yearly）與索引（manifest.json），
   並記錄本月 API 呼叫次數與傳輸量預估點數，確保基礎會員每月免費 3 點額度安全無虞。

環境變數：
  TDX_CLIENT_ID      必填，TDX 應用程式 Client ID
  TDX_CLIENT_SECRET  必填，TDX 應用程式 Client Secret
  DATA_DIR           選填，輸出目錄，預設 web/data/live
  COLLECT_SCOPE      選填，all（預設，全臺所有車站）或 major（僅本島 19 縣市主要車站）
  MAX_MONTHLY_POINTS 選填，安全熔斷上限（預設 2.75 點，為基礎會員 3 點預留緩衝）
"""

from __future__ import annotations

import gzip
import json
import math
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

from stations_catalog import (
    MAJOR_STATION_IDS,
    MAJOR_STATION_ORDER,
    get_builtin_stations_dict,
    infer_line,
    infer_region,
    normalize_city,
    normalize_train_type,
)

TZ_TAIPEI = timezone(timedelta(hours=8))
TDX_AUTH_URL = "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token"
TDX_BASE_URL = "https://tdx.transportdata.tw/api/basic/v3/Rail/TRA"

SELECT_FIELDS = (
    "StationID,StationName,TrainNo,Direction,TrainTypeCode,TrainTypeName,"
    "EndingStationID,EndingStationName,TripLine,ScheduleArrivalTime,"
    "ScheduleDepartureTime,DelayTime,RunningStatus,UpdateTime"
)

BUCKET_LABELS = ["0", "1-5", "6-15", "16-30", "31+"]
REGION_ORDER = ["北部", "中部", "南部", "東部"]


def now_taipei() -> datetime:
    return datetime.now(TZ_TAIPEI)


def read_json(path: Path, default):
    if not path.exists():
        return default
    try:
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    tmp.replace(path)


def delay_bucket_index(delay: int) -> int:
    if delay <= 0:
        return 0
    if delay <= 5:
        return 1
    if delay <= 15:
        return 2
    if delay <= 30:
        return 3
    return 4


def get_tdx_token(client_id: str, client_secret: str) -> str:
    body = urllib.parse.urlencode(
        {
            "grant_type": "client_credentials",
            "client_id": client_id,
            "client_secret": client_secret,
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        TDX_AUTH_URL,
        data=body,
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "TRA-Punctuality-Dashboard/1.0",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
        token = payload.get("access_token")
        if not token:
            raise RuntimeError(f"TDX OAuth 回傳缺少 access_token: {payload}")
        return token


def tdx_get_json(url: str, token: str) -> tuple[object, int]:
    """回傳 (json_obj, uncompressed_bytes_for_conservative_quota_accounting)。"""
    req = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
            "Accept-Encoding": "gzip",
            "User-Agent": "TRA-Punctuality-Dashboard/1.0",
        },
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=45) as resp:
        raw = resp.read()
        encoding = (resp.headers.get("Content-Encoding") or "").lower()
        if encoding == "gzip" or raw[:2] == b"\x1f\x8b":
            data_bytes = gzip.decompress(raw)
        else:
            data_bytes = raw
        return json.loads(data_bytes.decode("utf-8")), len(data_bytes)


def extract_zh(obj, fallback: str = "") -> str:
    if isinstance(obj, dict):
        return (obj.get("Zh_tw") or obj.get("Zh_Tw") or obj.get("En") or fallback).strip()
    if isinstance(obj, str):
        return obj.strip() or fallback
    return fallback


def refresh_stations_catalog(data_dir: Path, token: str, quota: dict) -> dict[str, dict]:
    stations_file = data_dir / "stations.json"
    existing = read_json(stations_file, None)
    now = now_taipei()

    need_refresh = True
    if existing and existing.get("updated_at"):
        try:
            prev = datetime.fromisoformat(existing["updated_at"])
            if (now - prev) < timedelta(days=7) and len(existing.get("stations", {})) >= 150:
                need_refresh = False
        except Exception:
            need_refresh = True

    catalog = get_builtin_stations_dict()
    if existing and isinstance(existing.get("stations"), dict):
        for sid, info in existing["stations"].items():
            if sid not in catalog:
                catalog[sid] = info

    if not need_refresh:
        return catalog

    url = f"{TDX_BASE_URL}/Station?$format=JSON"
    try:
        payload, nbytes = tdx_get_json(url, token)
        quota["api_calls"] += 1
        quota["bytes_downloaded"] += nbytes
        items = payload.get("Stations", payload) if isinstance(payload, dict) else payload
        if isinstance(items, list) and items:
            for st in items:
                sid = str(st.get("StationID") or "").strip()
                if not sid:
                    continue
                pos = st.get("StationPosition") or {}
                lat = pos.get("PositionLat")
                lon = pos.get("PositionLon")
                city = normalize_city(st.get("LocationCity"))
                base = catalog.get(sid, {})
                catalog[sid] = {
                    "id": sid,
                    "name": extract_zh(st.get("StationName"), base.get("name", sid)),
                    "en": (st.get("StationName", {}).get("En") if isinstance(st.get("StationName"), dict) else base.get("en", "")),
                    "city": city if city != "其他" else base.get("city", "其他"),
                    "region": base.get("region") or infer_region(city, sid),
                    "line": base.get("line") or infer_line(sid),
                    "lat": round(float(lat), 5) if lat is not None else base.get("lat"),
                    "lon": round(float(lon), 5) if lon is not None else base.get("lon"),
                    "class": str(st.get("StationClass") or base.get("class") or "3"),
                    "is_major": sid in MAJOR_STATION_IDS,
                }
            write_json(
                stations_file,
                {
                    "updated_at": now.isoformat(timespec="seconds"),
                    "major_station_ids": MAJOR_STATION_ORDER,
                    "stations": catalog,
                },
            )
            print(f"[INFO] 已更新全臺車站基本資料：共 {len(catalog)} 站（{nbytes / 1024:.1f} KB）")
    except Exception as exc:
        print(f"[WARN] 更新車站清單失敗，改用內建清單：{exc}")

    return catalog


def _extract_liveboard_items(payload: object) -> list[dict]:
    """相容 TDX v3 物件包裝（StationLiveBoards / TrainLiveBoards）與 v2 陣列回傳，並展開可能之巢狀 StationTrainInfo。"""
    if isinstance(payload, dict):
        items = (
            payload.get("StationLiveBoards")
            or payload.get("TrainLiveBoards")
            or payload.get("LiveBoards")
            or []
        )
    elif isinstance(payload, list):
        items = payload
    else:
        return []

    flat: list[dict] = []
    for entry in items:
        if not isinstance(entry, dict):
            continue
        nested = entry.get("StationTrainInfo")
        if isinstance(nested, list):
            base_sid = entry.get("StationID")
            base_sname = entry.get("StationName")
            for sub in nested:
                if isinstance(sub, dict):
                    merged = dict(sub)
                    merged.setdefault("StationID", base_sid)
                    merged.setdefault("StationName", base_sname)
                    flat.append(merged)
        else:
            flat.append(entry)
    return flat


def fetch_station_liveboards(token: str, scope: str, quota: dict) -> tuple[list[dict], str]:
    """取得即時車站到離站看板。優先以單一壓縮請求抓取全站，若設定 major 或發生限制則切為 19 主站過濾，並具備 TrainLiveBoard 備援。"""
    if scope != "major":
        url = f"{TDX_BASE_URL}/StationLiveBoard?$format=JSON"
        try:
            payload, nbytes = tdx_get_json(url, token)
            quota["api_calls"] += 1
            quota["bytes_downloaded"] += nbytes
            items = _extract_liveboard_items(payload)
            print(f"[INFO] 全臺 StationLiveBoard 抓取成功：{len(items)} 筆（{nbytes / 1024:.1f} KB）")
            return items, "all"
        except Exception as exc:
            print(f"[WARN] 全臺 StationLiveBoard 抓取失敗，自動降級為 19 縣市主要車站：{exc}")

    # 精簡模式：以單次 OData $filter 抓取本島 19 縣市主要車站
    filter_expr = " or ".join(f"StationID eq '{sid}'" for sid in MAJOR_STATION_ORDER)
    url = (
        f"{TDX_BASE_URL}/StationLiveBoard"
        f"?$filter={urllib.parse.quote(filter_expr)}&$format=JSON"
    )
    try:
        payload, nbytes = tdx_get_json(url, token)
        quota["api_calls"] += 1
        quota["bytes_downloaded"] += nbytes
        items = _extract_liveboard_items(payload)
        print(f"[INFO] 19 縣市主站 StationLiveBoard 抓取成功：{len(items)} 筆（{nbytes / 1024:.1f} KB）")
        return items, "major"
    except Exception as exc:
        print(f"[WARN] 19 縣市主站 StationLiveBoard 失敗，改用 TrainLiveBoard 全線即時列車備援：{exc}")

    fallback_url = f"{TDX_BASE_URL}/TrainLiveBoard?$format=JSON"
    payload, nbytes = tdx_get_json(fallback_url, token)
    quota["api_calls"] += 1
    quota["bytes_downloaded"] += nbytes
    items = _extract_liveboard_items(payload)
    print(f"[INFO] TrainLiveBoard 備援抓取成功：{len(items)} 筆（{nbytes / 1024:.1f} KB）")
    return items, "all"


def resolve_service_date(now: datetime, schedule_time: str) -> str:
    """處理跨午夜班次歸屬日期，避免 23:55 誤點至 00:05 被拆到兩天。"""
    try:
        hh = int(schedule_time.split(":")[0])
    except Exception:
        return now.strftime("%Y-%m-%d")
    if now.hour <= 2 and hh >= 21:
        return (now - timedelta(days=1)).strftime("%Y-%m-%d")
    if now.hour >= 22 and hh <= 2:
        return (now + timedelta(days=1)).strftime("%Y-%m-%d")
    return now.strftime("%Y-%m-%d")


def merge_observations(state_dir: Path, items: list[dict], stations: dict[str, dict], now: datetime) -> set[str]:
    """以 (StationID, TrainNo, ScheduleHHMM) 去重寫入每日觀測狀態，回傳受影響的日期集合。"""
    touched_dates: set[str] = set()
    states_cache: dict[str, dict] = {}

    for rec in items:
        sid = str(rec.get("StationID") or "").strip()
        train_no = str(rec.get("TrainNo") or "").strip()
        if not sid or not train_no:
            continue

        sch_raw = str(rec.get("ScheduleDepartureTime") or rec.get("ScheduleArrivalTime") or "").strip()
        sch_hm = sch_raw[:5] if len(sch_raw) >= 5 else now.strftime("%H:%M")
        service_date = resolve_service_date(now, sch_hm)

        if service_date not in states_cache:
            state_path = state_dir / f"{service_date}.json"
            states_cache[service_date] = read_json(state_path, {"date": service_date, "records": {}})

        raw_delay = rec.get("DelayTime")
        try:
            delay = max(0, int(raw_delay))
        except Exception:
            delay = 0

        running_status = rec.get("RunningStatus")
        if running_status is None:
            running_status = rec.get("TrainStatus")
        cancelled = False
        if isinstance(running_status, int) and running_status == 2:
            cancelled = True
        elif isinstance(running_status, str) and running_status.lower() in ("2", "cancel", "cancelled"):
            cancelled = True

        direction = rec.get("Direction")
        dir_str = "1" if str(direction) == "1" else "0"

        type_name_raw = extract_zh(rec.get("TrainTypeName"), "")
        type_code = str(rec.get("TrainTypeCode") or rec.get("TrainTypeID") or "")
        train_type = normalize_train_type(type_name_raw, type_code)
        ending_name = extract_zh(rec.get("EndingStationName"), "")
        st_name = extract_zh(rec.get("StationName"), stations.get(sid, {}).get("name", sid))
        upd_time = str(rec.get("UpdateTime") or now.isoformat(timespec="seconds"))

        obs_key = f"{sid}|{train_no}|{sch_hm}"
        prev = states_cache[service_date]["records"].get(obs_key)
        # 保留最新觀測（越靠近發車時間越準確）
        if prev is None or upd_time >= prev.get("upd", ""):
            states_cache[service_date]["records"][obs_key] = {
                "s": sid,
                "sn": st_name,
                "t": train_no,
                "d": delay,
                "dir": dir_str,
                "type": train_type,
                "end": ending_name,
                "sch": sch_hm,
                "can": cancelled,
                "upd": upd_time,
            }
            touched_dates.add(service_date)

        # 若遇到新車站則即時補登
        if sid not in stations:
            stations[sid] = {
                "id": sid,
                "name": st_name,
                "en": "",
                "city": "其他",
                "region": infer_region(None, sid),
                "line": infer_line(sid),
                "lat": None,
                "lon": None,
                "class": "3",
                "is_major": sid in MAJOR_STATION_IDS,
            }

    for date_str in touched_dates:
        write_json(state_dir / f"{date_str}.json", states_cache[date_str])

    # 僅保留近 4 天原始去重狀態以維持 repository 輕量
    cutoff = (now - timedelta(days=4)).strftime("%Y-%m-%d")
    if state_dir.exists():
        for fp in state_dir.glob("*.json"):
            if fp.stem < cutoff:
                try:
                    fp.unlink()
                except Exception:
                    pass

    return touched_dates


def empty_summary() -> dict:
    return {
        "total": 0,
        "ontime_0": 0,
        "ontime_5": 0,
        "delay_sum": 0,
        "delayed_gt0": 0,
        "delayed_gt5": 0,
        "delay_sum_gt0": 0,
        "max_delay": 0,
        "p90_delay": 0,
        "cancelled": 0,
        "buckets": [0, 0, 0, 0, 0],
    }


def add_record_to_summary(summary: dict, delay: int, cancelled: bool) -> None:
    summary["total"] += 1
    if cancelled:
        summary["cancelled"] += 1
    if delay == 0:
        summary["ontime_0"] += 1
    else:
        summary["delayed_gt0"] += 1
        summary["delay_sum_gt0"] += delay
    if delay <= 5:
        summary["ontime_5"] += 1
    else:
        summary["delayed_gt5"] += 1
    summary["delay_sum"] += delay
    if delay > summary["max_delay"]:
        summary["max_delay"] = delay
    summary["buckets"][delay_bucket_index(delay)] += 1


def compute_p90_from_delays(delays: list[int]) -> int:
    if not delays:
        return 0
    s = sorted(delays)
    idx = min(len(s) - 1, int(math.ceil(0.90 * len(s))) - 1)
    return int(s[max(0, idx)])


def estimate_p90_from_buckets(buckets: list[int], total: int) -> int:
    """從分桶估算 P90（供月/年彙整使用）。"""
    if total <= 0:
        return 0
    target = total * 0.90
    cum = 0
    bounds = [(0, 0), (1, 5), (6, 15), (16, 30), (31, 50)]
    for count, (lo, hi) in zip(buckets, bounds):
        prev = cum
        cum += count
        if cum >= target and count > 0:
            frac = (target - prev) / count
            return int(round(lo + frac * (hi - lo)))
    return 35


def build_scope_block_from_records(records: list[dict], stations: dict[str, dict], date_str: str) -> dict:
    summary = empty_summary()
    delays_list: list[int] = []
    hourly = [
        {"h": h, "total": 0, "ontime_0": 0, "ontime_5": 0, "delay_sum": 0, "max_delay": 0, "buckets": [0, 0, 0, 0, 0]}
        for h in range(24)
    ]
    train_types: dict[str, dict] = {}
    directions = {
        "0": {"name": "順行（北上／往臺北）", "total": 0, "ontime_0": 0, "ontime_5": 0, "delay_sum": 0, "max_delay": 0},
        "1": {"name": "逆行（南下／往高雄臺東）", "total": 0, "ontime_0": 0, "ontime_5": 0, "delay_sum": 0, "max_delay": 0},
    }
    regions = {
        r: {"total": 0, "ontime_0": 0, "ontime_5": 0, "delay_sum": 0, "max_delay": 0, "buckets": [0, 0, 0, 0, 0]}
        for r in REGION_ORDER
    }
    # region_hour_matrix: { region: [[total, delay_sum], ...] * 24 }
    region_hour = {r: [[0, 0] for _ in range(24)] for r in REGION_ORDER}

    for rec in records:
        d = int(rec["d"])
        can = bool(rec.get("can", False))
        add_record_to_summary(summary, d, can)
        delays_list.append(d)

        try:
            hr = max(0, min(23, int(rec["sch"].split(":")[0])))
        except Exception:
            hr = 12
        bidx = delay_bucket_index(d)

        hobj = hourly[hr]
        hobj["total"] += 1
        if d == 0:
            hobj["ontime_0"] += 1
        if d <= 5:
            hobj["ontime_5"] += 1
        hobj["delay_sum"] += d
        if d > hobj["max_delay"]:
            hobj["max_delay"] = d
        hobj["buckets"][bidx] += 1

        tt = rec.get("type") or "其他車種"
        if tt not in train_types:
            train_types[tt] = {
                "total": 0,
                "ontime_0": 0,
                "ontime_5": 0,
                "delay_sum": 0,
                "max_delay": 0,
                "buckets": [0, 0, 0, 0, 0],
            }
        tobj = train_types[tt]
        tobj["total"] += 1
        if d == 0:
            tobj["ontime_0"] += 1
        if d <= 5:
            tobj["ontime_5"] += 1
        tobj["delay_sum"] += d
        if d > tobj["max_delay"]:
            tobj["max_delay"] = d
        tobj["buckets"][bidx] += 1

        dk = "1" if str(rec.get("dir")) == "1" else "0"
        dobj = directions[dk]
        dobj["total"] += 1
        if d == 0:
            dobj["ontime_0"] += 1
        if d <= 5:
            dobj["ontime_5"] += 1
        dobj["delay_sum"] += d
        if d > dobj["max_delay"]:
            dobj["max_delay"] = d

        st_meta = stations.get(rec["s"], {})
        reg = st_meta.get("region") or infer_region(st_meta.get("city"), rec["s"])
        if reg not in regions:
            reg = "北部"
        robj = regions[reg]
        robj["total"] += 1
        if d == 0:
            robj["ontime_0"] += 1
        if d <= 5:
            robj["ontime_5"] += 1
        robj["delay_sum"] += d
        if d > robj["max_delay"]:
            robj["max_delay"] = d
        robj["buckets"][bidx] += 1

        region_hour[reg][hr][0] += 1
        region_hour[reg][hr][1] += d

    summary["p90_delay"] = compute_p90_from_delays(delays_list)

    # 單日趨勢＝各小時趨勢
    trend = [
        {
            "key": f"{h['h']:02d}:00",
            "label": f"{h['h']:02d}時",
            "total": h["total"],
            "ontime_0": h["ontime_0"],
            "ontime_5": h["ontime_5"],
            "delay_sum": h["delay_sum"],
            "max_delay": h["max_delay"],
        }
        for h in hourly
        if h["total"] > 0 or 5 <= h["h"] <= 23
    ]

    # 高誤點焦點班次（取前 25 筆）
    delayed_records = [r for r in records if int(r["d"]) > 0 or r.get("can")]
    delayed_records.sort(key=lambda r: (int(r["d"]), r["sch"]), reverse=True)
    top_delays = [
        {
            "date": date_str,
            "train_no": r["t"],
            "train_type": r.get("type", "其他車種"),
            "station_id": r["s"],
            "station_name": r.get("sn") or stations.get(r["s"], {}).get("name", r["s"]),
            "ending_station": r.get("end", ""),
            "direction": 1 if str(r.get("dir")) == "1" else 0,
            "schedule_time": r["sch"],
            "delay": int(r["d"]),
            "status": "停駛" if r.get("can") else ("嚴重誤點" if int(r["d"]) > 15 else "誤點"),
        }
        for r in delayed_records[:25]
    ]

    return {
        "summary": summary,
        "hourly": hourly,
        "train_types": train_types,
        "directions": directions,
        "regions": regions,
        "region_hour_matrix": region_hour,
        "trend": trend,
        "top_delays": top_delays,
    }


def build_daily_aggregate(date_str: str, records_map: dict[str, dict], stations: dict[str, dict], now: datetime) -> dict:
    all_records = list(records_map.values())
    major_records = [r for r in all_records if r["s"] in MAJOR_STATION_IDS]

    station_stats: dict[str, dict] = {}
    for rec in all_records:
        sid = rec["s"]
        d = int(rec["d"])
        can = bool(rec.get("can", False))
        try:
            hr = max(0, min(23, int(rec["sch"].split(":")[0])))
        except Exception:
            hr = 12
        tt = rec.get("type") or "其他車種"
        dk = "1" if str(rec.get("dir")) == "1" else "0"

        if sid not in station_stats:
            station_stats[sid] = {
                "total": 0,
                "ontime_0": 0,
                "ontime_5": 0,
                "delay_sum": 0,
                "delayed_gt0": 0,
                "delayed_gt5": 0,
                "max_delay": 0,
                "cancelled": 0,
                "buckets": [0, 0, 0, 0, 0],
                "hourly": [[0, 0, 0, 0] for _ in range(24)],
                "train_types": {},
                "directions": {"0": [0, 0, 0, 0], "1": [0, 0, 0, 0]},
            }
        st = station_stats[sid]
        st["total"] += 1
        if can:
            st["cancelled"] += 1
        if d == 0:
            st["ontime_0"] += 1
        else:
            st["delayed_gt0"] += 1
        if d <= 5:
            st["ontime_5"] += 1
        else:
            st["delayed_gt5"] += 1
        st["delay_sum"] += d
        if d > st["max_delay"]:
            st["max_delay"] = d
        st["buckets"][delay_bucket_index(d)] += 1

        hv = st["hourly"][hr]
        hv[0] += 1
        if d == 0:
            hv[1] += 1
        if d <= 5:
            hv[2] += 1
        hv[3] += d

        if tt not in st["train_types"]:
            st["train_types"][tt] = [0, 0, 0, 0]
        tv = st["train_types"][tt]
        tv[0] += 1
        if d == 0:
            tv[1] += 1
        if d <= 5:
            tv[2] += 1
        tv[3] += d

        dv = st["directions"][dk]
        dv[0] += 1
        if d == 0:
            dv[1] += 1
        if d <= 5:
            dv[2] += 1
        dv[3] += d

    dt = datetime.strptime(date_str, "%Y-%m-%d")
    return {
        "granularity": "daily",
        "period": date_str,
        "label": f"{dt.year} 年 {dt.month:02d} 月 {dt.day:02d} 日",
        "updated_at": now.isoformat(timespec="seconds"),
        "days_covered": 1,
        "scope_stats": {
            "major": build_scope_block_from_records(major_records, stations, date_str),
            "all": build_scope_block_from_records(all_records, stations, date_str),
        },
        "stations": station_stats,
    }


def merge_period_files(granularity: str, period_key: str, label: str, child_docs: list[dict], now: datetime) -> dict:
    """精確合併多份日檔（→月檔）或多份月檔（→年檔）。"""

    def merge_scope(scope_name: str) -> dict:
        summary = empty_summary()
        hourly = [
            {"h": h, "total": 0, "ontime_0": 0, "ontime_5": 0, "delay_sum": 0, "max_delay": 0, "buckets": [0, 0, 0, 0, 0]}
            for h in range(24)
        ]
        train_types: dict[str, dict] = {}
        directions = {
            "0": {"name": "順行（北上／往臺北）", "total": 0, "ontime_0": 0, "ontime_5": 0, "delay_sum": 0, "max_delay": 0},
            "1": {"name": "逆行（南下／往高雄臺東）", "total": 0, "ontime_0": 0, "ontime_5": 0, "delay_sum": 0, "max_delay": 0},
        }
        regions = {
            r: {"total": 0, "ontime_0": 0, "ontime_5": 0, "delay_sum": 0, "max_delay": 0, "buckets": [0, 0, 0, 0, 0]}
            for r in REGION_ORDER
        }
        region_hour = {r: [[0, 0] for _ in range(24)] for r in REGION_ORDER}
        trend = []
        all_top_delays = []

        for doc in child_docs:
            blk = doc.get("scope_stats", {}).get(scope_name)
            if not blk:
                continue
            cs = blk["summary"]
            for k in ("total", "ontime_0", "ontime_5", "delay_sum", "delayed_gt0", "delayed_gt5", "delay_sum_gt0", "cancelled"):
                summary[k] += int(cs.get(k, 0))
            summary["max_delay"] = max(summary["max_delay"], int(cs.get("max_delay", 0)))
            for i in range(5):
                summary["buckets"][i] += int(cs["buckets"][i])

            for h in range(24):
                ch = blk["hourly"][h]
                hourly[h]["total"] += int(ch["total"])
                hourly[h]["ontime_0"] += int(ch["ontime_0"])
                hourly[h]["ontime_5"] += int(ch["ontime_5"])
                hourly[h]["delay_sum"] += int(ch["delay_sum"])
                hourly[h]["max_delay"] = max(hourly[h]["max_delay"], int(ch.get("max_delay", 0)))
                for i in range(5):
                    hourly[h]["buckets"][i] += int(ch["buckets"][i])

            for tt, ctt in blk.get("train_types", {}).items():
                if tt not in train_types:
                    train_types[tt] = {
                        "total": 0,
                        "ontime_0": 0,
                        "ontime_5": 0,
                        "delay_sum": 0,
                        "max_delay": 0,
                        "buckets": [0, 0, 0, 0, 0],
                    }
                for k in ("total", "ontime_0", "ontime_5", "delay_sum"):
                    train_types[tt][k] += int(ctt.get(k, 0))
                train_types[tt]["max_delay"] = max(train_types[tt]["max_delay"], int(ctt.get("max_delay", 0)))
                for i in range(5):
                    train_types[tt]["buckets"][i] += int(ctt["buckets"][i])

            for dk in ("0", "1"):
                cd = blk.get("directions", {}).get(dk)
                if cd:
                    for k in ("total", "ontime_0", "ontime_5", "delay_sum"):
                        directions[dk][k] += int(cd.get(k, 0))
                    directions[dk]["max_delay"] = max(directions[dk]["max_delay"], int(cd.get("max_delay", 0)))

            for r in REGION_ORDER:
                cr = blk.get("regions", {}).get(r)
                if cr:
                    for k in ("total", "ontime_0", "ontime_5", "delay_sum"):
                        regions[r][k] += int(cr.get(k, 0))
                    regions[r]["max_delay"] = max(regions[r]["max_delay"], int(cr.get("max_delay", 0)))
                    for i in range(5):
                        regions[r]["buckets"][i] += int(cr["buckets"][i])
                crh = blk.get("region_hour_matrix", {}).get(r)
                if crh:
                    for h in range(24):
                        region_hour[r][h][0] += int(crh[h][0])
                        region_hour[r][h][1] += int(crh[h][1])

            child_period = doc["period"]
            if granularity == "monthly":
                dt = datetime.strptime(child_period, "%Y-%m-%d")
                trend.append(
                    {
                        "key": child_period,
                        "label": f"{dt.month}/{dt.day:02d}",
                        "weekday": dt.weekday(),
                        "total": int(cs["total"]),
                        "ontime_0": int(cs["ontime_0"]),
                        "ontime_5": int(cs["ontime_5"]),
                        "delay_sum": int(cs["delay_sum"]),
                        "max_delay": int(cs["max_delay"]),
                    }
                )
            else:
                mm = int(child_period.split("-")[1])
                trend.append(
                    {
                        "key": child_period,
                        "label": f"{mm}月",
                        "total": int(cs["total"]),
                        "ontime_0": int(cs["ontime_0"]),
                        "ontime_5": int(cs["ontime_5"]),
                        "delay_sum": int(cs["delay_sum"]),
                        "max_delay": int(cs["max_delay"]),
                    }
                )

            all_top_delays.extend(blk.get("top_delays", []))

        summary["p90_delay"] = estimate_p90_from_buckets(summary["buckets"], summary["total"])
        all_top_delays.sort(key=lambda r: (int(r["delay"]), r.get("date", "")), reverse=True)

        return {
            "summary": summary,
            "hourly": hourly,
            "train_types": train_types,
            "directions": directions,
            "regions": regions,
            "region_hour_matrix": region_hour,
            "trend": trend,
            "top_delays": all_top_delays[:30],
        }

    # 合併各站統計
    merged_stations: dict[str, dict] = {}
    for doc in child_docs:
        for sid, cst in doc.get("stations", {}).items():
            if sid not in merged_stations:
                merged_stations[sid] = {
                    "total": 0,
                    "ontime_0": 0,
                    "ontime_5": 0,
                    "delay_sum": 0,
                    "delayed_gt0": 0,
                    "delayed_gt5": 0,
                    "max_delay": 0,
                    "cancelled": 0,
                    "buckets": [0, 0, 0, 0, 0],
                    "hourly": [[0, 0, 0, 0] for _ in range(24)],
                    "train_types": {},
                    "directions": {"0": [0, 0, 0, 0], "1": [0, 0, 0, 0]},
                }
            st = merged_stations[sid]
            for k in ("total", "ontime_0", "ontime_5", "delay_sum", "delayed_gt0", "delayed_gt5", "cancelled"):
                st[k] += int(cst.get(k, 0))
            st["max_delay"] = max(st["max_delay"], int(cst.get("max_delay", 0)))
            for i in range(5):
                st["buckets"][i] += int(cst["buckets"][i])
            for h in range(24):
                for j in range(4):
                    st["hourly"][h][j] += int(cst["hourly"][h][j])
            for tt, tv in cst.get("train_types", {}).items():
                if tt not in st["train_types"]:
                    st["train_types"][tt] = [0, 0, 0, 0]
                for j in range(4):
                    st["train_types"][tt][j] += int(tv[j])
            for dk in ("0", "1"):
                dv = cst.get("directions", {}).get(dk)
                if dv:
                    for j in range(4):
                        st["directions"][dk][j] += int(dv[j])

    days_covered = sum(int(d.get("days_covered", 1)) for d in child_docs)
    return {
        "granularity": granularity,
        "period": period_key,
        "label": label,
        "updated_at": now.isoformat(timespec="seconds"),
        "days_covered": days_covered,
        "scope_stats": {
            "major": merge_scope("major"),
            "all": merge_scope("all"),
        },
        "stations": merged_stations,
    }


def rebuild_rollups_and_manifest(
    data_dir: Path,
    affected_dates: set[str],
    stations: dict[str, dict],
    now: datetime,
    effective_scope: str,
    quota: dict,
    last_records: int,
) -> None:
    daily_dir = data_dir / "daily"
    monthly_dir = data_dir / "monthly"
    yearly_dir = data_dir / "yearly"
    state_dir = data_dir / "state"

    affected_months: set[str] = set()
    affected_years: set[str] = set()

    for date_str in sorted(affected_dates):
        state = read_json(state_dir / f"{date_str}.json", None)
        if not state or not state.get("records"):
            continue
        daily_doc = build_daily_aggregate(date_str, state["records"], stations, now)
        write_json(daily_dir / f"{date_str}.json", daily_doc)
        affected_months.add(date_str[:7])
        affected_years.add(date_str[:4])

    for month_str in sorted(affected_months):
        day_files = sorted(daily_dir.glob(f"{month_str}-*.json"))
        docs = [read_json(p, None) for p in day_files]
        docs = [d for d in docs if d]
        if docs:
            yy, mm = month_str.split("-")
            monthly_doc = merge_period_files("monthly", month_str, f"{yy} 年 {int(mm):02d} 月", docs, now)
            write_json(monthly_dir / f"{month_str}.json", monthly_doc)

    for year_str in sorted(affected_years):
        month_files = sorted(monthly_dir.glob(f"{year_str}-*.json"))
        docs = [read_json(p, None) for p in month_files]
        docs = [d for d in docs if d]
        if docs:
            yearly_doc = merge_period_files("yearly", year_str, f"{year_str} 年度", docs, now)
            write_json(yearly_dir / f"{year_str}.json", yearly_doc)

    avail_daily = sorted([p.stem for p in daily_dir.glob("*.json")], reverse=True) if daily_dir.exists() else []
    avail_monthly = sorted([p.stem for p in monthly_dir.glob("*.json")], reverse=True) if monthly_dir.exists() else []
    avail_yearly = sorted([p.stem for p in yearly_dir.glob("*.json")], reverse=True) if yearly_dir.exists() else []

    est_pts = round(quota["api_calls"] / 1500.0 + quota["bytes_downloaded"] / (150.0 * 1024 * 1024), 3)
    manifest = {
        "source": "live",
        "generated_at": now.isoformat(timespec="seconds"),
        "scope": effective_scope,
        "station_count": len(stations),
        "available": {
            "daily": avail_daily,
            "monthly": avail_monthly,
            "yearly": avail_yearly,
        },
        "latest": {
            "daily": avail_daily[0] if avail_daily else None,
            "monthly": avail_monthly[0] if avail_monthly else None,
            "yearly": avail_yearly[0] if avail_yearly else None,
        },
        "quota": {
            "month": quota["month"],
            "api_calls": quota["api_calls"],
            "bytes_downloaded": quota["bytes_downloaded"],
            "estimated_points": est_pts,
            "free_tier_points": 3.0,
            "last_poll_status": "ok",
            "last_poll_records": last_records,
        },
    }
    write_json(data_dir / "manifest.json", manifest)
    print(
        f"[DONE] 彙整完成：日檔 {len(avail_daily)} / 月檔 {len(avail_monthly)} / 年檔 {len(avail_yearly)}，"
        f"本月估計耗點 {est_pts:.3f} 點（呼叫 {quota['api_calls']} 次，{quota['bytes_downloaded'] / (1024 * 1024):.2f} MB）"
    )


def main() -> int:
    client_id = os.environ.get("TDX_CLIENT_ID", "").strip()
    client_secret = os.environ.get("TDX_CLIENT_SECRET", "").strip()
    data_dir = Path(os.environ.get("DATA_DIR", "web/data/live"))
    scope = os.environ.get("COLLECT_SCOPE", "all").strip().lower()
    max_monthly_points = float(os.environ.get("MAX_MONTHLY_POINTS", "2.75"))

    if not client_id or not client_secret:
        print("[SKIP] 未設定 TDX_CLIENT_ID / TDX_CLIENT_SECRET，略過本次採集。")
        return 0

    now = now_taipei()
    cur_month = now.strftime("%Y-%m")
    prev_manifest = read_json(data_dir / "manifest.json", {})
    prev_quota = prev_manifest.get("quota") or {}

    if prev_quota.get("month") == cur_month:
        quota = {
            "month": cur_month,
            "api_calls": int(prev_quota.get("api_calls", 0)),
            "bytes_downloaded": int(prev_quota.get("bytes_downloaded", 0)),
        }
    else:
        quota = {"month": cur_month, "api_calls": 0, "bytes_downloaded": 0}

    cur_points = quota["api_calls"] / 1500.0 + quota["bytes_downloaded"] / (150.0 * 1024 * 1024)
    if cur_points >= max_monthly_points:
        print(
            f"[GUARD] 本月估計已使用 {cur_points:.3f} 點（上限 {max_monthly_points} 點），"
            "啟動免費點數保護機制，暫停本次呼叫。"
        )
        return 0

    token = get_tdx_token(client_id, client_secret)
    stations = refresh_stations_catalog(data_dir, token, quota)
    items, effective_scope = fetch_station_liveboards(token, scope, quota)

    state_dir = data_dir / "state"
    touched_dates = merge_observations(state_dir, items, stations, now)
    if not touched_dates:
        # 即使當下深夜無列車，仍更新 manifest 的時間戳與點數紀錄
        touched_dates = set()

    rebuild_rollups_and_manifest(
        data_dir=data_dir,
        affected_dates=touched_dates,
        stations=stations,
        now=now,
        effective_scope=effective_scope,
        quota=quota,
        last_records=len(items),
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except urllib.error.HTTPError as e:
        print(f"[ERROR] TDX HTTP 錯誤 {e.code}: {e.read().decode('utf-8', errors='ignore')[:400]}", file=sys.stderr)
        raise SystemExit(1)
    except Exception as e:
        print(f"[ERROR] 採集失敗: {e}", file=sys.stderr)
        raise SystemExit(1)
