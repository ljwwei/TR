#!/usr/bin/env python3
"""
產生符合正式 TDX Schema 的展示用示範資料集（web/data/demo/）與基本車站表（web/data/stations.json）。
說明：本資料集僅作為未接上 TDX 金鑰前或歷史資料尚在累積期間的介面展示用途，
前端介面會明確標示為「示範資料」；一旦 TDX 即時採集啟動，系統將自動切換至真實 TDX 數據。
"""

from __future__ import annotations

import math
import random
from datetime import date, datetime, timedelta
from pathlib import Path

from collect_tdx import (
    TZ_TAIPEI,
    build_daily_aggregate,
    merge_period_files,
    write_json,
)
from stations_catalog import (
    MAJOR_STATION_ORDER,
    get_builtin_stations_dict,
)

TRAIN_TYPE_WEIGHTS = [
    ("區間車", 0.44, 0.75),
    ("自強號", 0.17, 1.38),
    ("新自強(3000)", 0.14, 0.96),
    ("區間快", 0.09, 0.92),
    ("莒光號", 0.06, 1.55),
    ("普悠瑪", 0.06, 1.15),
    ("太魯閣", 0.04, 1.10),
]

STATION_VOLUME = {
    "1000": 265, "1020": 235, "0990": 220, "1080": 195, "1100": 185,
    "1210": 175, "3300": 185, "3360": 170, "4220": 165, "4400": 170,
    "4340": 160, "4080": 140, "0900": 135, "7190": 120, "7000": 115,
    "5000": 125, "3160": 105, "3470": 110, "6000": 88, "1180": 98,
    "4060": 82, "3432": 22, "3434": 18,
}

STATION_DELAY_FACTOR = {
    "1000": 1.12, "1020": 1.10, "1080": 1.16, "1100": 1.18, "1210": 1.05,
    "3300": 1.04, "3360": 1.14, "4220": 1.08, "4400": 1.02, "7000": 1.24,
    "6000": 1.22, "7190": 1.15, "0900": 0.85, "5000": 0.92, "3432": 0.72,
    "3434": 0.74, "1180": 0.95, "3160": 0.98, "3470": 1.01, "4060": 0.94,
    "4080": 1.03,
}

ENDINGS_BY_DIR = {
    "0": ["基隆", "七堵", "樹林", "臺北", "新竹", "花蓮", "蘇澳"],
    "1": ["彰化", "嘉義", "臺南", "高雄", "潮州", "屏東", "臺東"],
}


def sample_delay(rng: random.Random, risk: float) -> int:
    u = rng.random()
    p_ontime = max(0.42, min(0.84, 0.73 - 0.14 * (risk - 1.0)))
    if u < p_ontime:
        return 0
    if u < p_ontime + (1 - p_ontime) * 0.68:
        return rng.randint(1, 5)
    if u < p_ontime + (1 - p_ontime) * 0.91:
        return rng.randint(6, 15)
    if u < p_ontime + (1 - p_ontime) * 0.978:
        return rng.randint(16, 30)
    return rng.randint(31, 62)


def synthesize_day(day: date, stations: dict[str, dict], rng: random.Random, now: datetime) -> dict:
    date_str = day.strftime("%Y-%m-%d")
    is_weekend = day.weekday() >= 5
    # 季節與天候微擾（夏秋颱風雨季誤點略高）
    season_factor = 1.0 + 0.16 * math.sin((day.month - 4) / 12.0 * 2 * math.pi)
    if day.month in (7, 8, 9):
        season_factor += 0.14
    day_event = 1.38 if rng.random() < 0.08 else (1.0 + rng.uniform(-0.10, 0.12))
    weekend_factor = 1.09 if is_weekend else 1.0

    records: dict[str, dict] = {}
    train_seq = 100
    for sid, st in stations.items():
        base_vol = STATION_VOLUME.get(sid, 78 if st["class"] in ("1", "2") else 46)
        count = max(14, int(round(base_vol * (1.04 if is_weekend else 1.0) * rng.uniform(0.92, 1.08))))
        st_factor = STATION_DELAY_FACTOR.get(sid, 0.96 if st["region"] == "南部" else 1.03)

        for _ in range(count):
            train_seq += 1
            # 依時段分佈抽樣（尖峰班次較密）
            hr_weights = [
                0, 0, 0, 0, 0,
                2, 5, 9, 10, 8, 7, 7, 7, 7, 7, 8, 9, 11, 11, 9, 7, 6, 4, 2,
            ]
            hr = rng.choices(range(24), weights=hr_weights, k=1)[0]
            mm = rng.randint(0, 59)
            sch = f"{hr:02d}:{mm:02d}"

            rush_factor = 1.32 if hr in (7, 8, 17, 18, 19) else (0.82 if hr in (5, 6, 22, 23) else 1.0)
            tt_choice = rng.choices(TRAIN_TYPE_WEIGHTS, weights=[w[1] for w in TRAIN_TYPE_WEIGHTS], k=1)[0]
            tt_name, _, tt_factor = tt_choice
            if sid in ("3432", "3434"):
                tt_name, tt_factor = "區間車", 0.78

            dk = "1" if rng.random() < 0.51 else "0"
            dir_factor = 1.06 if dk == "1" else 0.95
            risk = st_factor * season_factor * day_event * weekend_factor * rush_factor * tt_factor * dir_factor
            delay = sample_delay(rng, risk)

            prefix = {"自強號": 1, "新自強(3000)": 3, "普悠瑪": 2, "太魯閣": 2, "莒光號": 5, "區間快": 3, "區間車": 2}[tt_name]
            tno = str(prefix * 1000 + (train_seq % 900)) if "區間" in tt_name else str(prefix * 100 + (train_seq % 90))
            key = f"{sid}|{tno}|{sch}"
            records[key] = {
                "s": sid,
                "sn": st["name"],
                "t": tno,
                "d": delay,
                "dir": dk,
                "type": tt_name,
                "end": rng.choice(ENDINGS_BY_DIR[dk]),
                "sch": sch,
                "can": False,
                "upd": f"{date_str}T{sch}:00+08:00",
            }

    return build_daily_aggregate(date_str, records, stations, now)


def main() -> int:
    root = Path(__file__).resolve().parent.parent
    web_data = root / "web" / "data"
    demo_dir = web_data / "demo"
    stations = get_builtin_stations_dict()
    now = datetime(2026, 11, 21, 23, 30, 0, tzinfo=TZ_TAIPEI)

    write_json(
        web_data / "stations.json",
        {
            "updated_at": now.isoformat(timespec="seconds"),
            "major_station_ids": MAJOR_STATION_ORDER,
            "stations": stations,
        },
    )

    rng = random.Random(20261121)
    # 產生 2026-11-01 ~ 2026-11-21（完整 21 天單日檔）與 2026 年 1~10 月月檔 + 2025 年月/年檔
    monthly_docs_2026: list[dict] = []
    daily_list: list[str] = []

    for month in range(1, 12):
        last_day = 21 if month == 11 else (date(2026, month + 1, 1) - timedelta(days=1)).day
        month_children: list[dict] = []
        for d in range(1, last_day + 1):
            day_obj = date(2026, month, d)
            doc = synthesize_day(day_obj, stations, rng, now)
            month_children.append(doc)
            if month == 11:
                write_json(demo_dir / "daily" / f"{doc['period']}.json", doc)
                daily_list.append(doc["period"])
        m_key = f"2026-{month:02d}"
        m_doc = merge_period_files("monthly", m_key, f"2026 年 {month:02d} 月", month_children, now)
        write_json(demo_dir / "monthly" / f"{m_key}.json", m_doc)
        monthly_docs_2026.append(m_doc)

    y2026 = merge_period_files("yearly", "2026", "2026 年度", monthly_docs_2026, now)
    write_json(demo_dir / "yearly" / "2026.json", y2026)

    # 同步產製 2025 全年度比較資料
    monthly_docs_2025: list[dict] = []
    for month in range(1, 13):
        sample_days = [date(2025, month, d) for d in (3, 8, 14, 20, 26)]
        children = [synthesize_day(d, stations, rng, now) for d in sample_days]
        m_key = f"2025-{month:02d}"
        m_doc = merge_period_files("monthly", m_key, f"2025 年 {month:02d} 月", children, now)
        monthly_docs_2025.append(m_doc)
    y2025 = merge_period_files("yearly", "2025", "2025 年度", monthly_docs_2025, now)
    write_json(demo_dir / "yearly" / "2025.json", y2025)

    manifest = {
        "source": "demo",
        "generated_at": now.isoformat(timespec="seconds"),
        "scope": "all",
        "station_count": len(stations),
        "available": {
            "daily": sorted(daily_list, reverse=True),
            "monthly": [f"2026-{m:02d}" for m in range(11, 0, -1)],
            "yearly": ["2026", "2025"],
        },
        "latest": {
            "daily": max(daily_list),
            "monthly": "2026-11",
            "yearly": "2026",
        },
        "quota": {
            "month": "2026-11",
            "api_calls": 0,
            "bytes_downloaded": 0,
            "estimated_points": 0.0,
            "free_tier_points": 3.0,
            "last_poll_status": "demo",
            "last_poll_records": 0,
        },
    }
    write_json(demo_dir / "manifest.json", manifest)
    print(f"[DONE] Demo dataset generated in {demo_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
