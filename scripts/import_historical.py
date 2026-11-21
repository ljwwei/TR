#!/usr/bin/env python3
"""
TDX 歷史資料匯入工具（選用）
若您從 TDX 會員中心「歷史服務」申請並下載了臺鐵過去的歷史看板 CSV 或 JSON 封包，
可使用本腳本批次匯入並自動產製 daily / monthly / yearly 靜態統計檔。

使用方式：
  python scripts/import_historical.py --input path/to/tdx_history.json --data-dir web/data/live
  python scripts/import_historical.py --input path/to/tdx_history.csv --date 2026-10-01 --data-dir web/data/live
"""

from __future__ import annotations

import argparse
import csv
import json
from datetime import datetime
from pathlib import Path

from collect_tdx import (
    TZ_TAIPEI,
    build_daily_aggregate,
    merge_period_files,
    now_taipei,
    read_json,
    write_json,
)
from stations_catalog import get_builtin_stations_dict, normalize_train_type


def load_rows(input_path: Path) -> list[dict]:
    if input_path.suffix.lower() == ".csv":
        with input_path.open("r", encoding="utf-8-sig", newline="") as f:
            return list(csv.DictReader(f))
    with input_path.open("r", encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, dict):
        for key in ("StationLiveBoards", "TrainLiveBoards", "Records", "data"):
            if isinstance(data.get(key), list):
                return data[key]
        return []
    return data if isinstance(data, list) else []


def extract_zh(val) -> str:
    if isinstance(val, dict):
        return (val.get("Zh_tw") or val.get("En") or "").strip()
    return str(val or "").strip()


def main() -> int:
    parser = argparse.ArgumentParser(description="匯入 TDX 臺鐵歷史資料至本專案靜態資料夾")
    parser.add_argument("--input", required=True, help="TDX 歷史資料檔路徑（.json 或 .csv）")
    parser.add_argument("--date", default="", help="預設資料日期 YYYY-MM-DD（若每筆資料未帶日期欄位時使用）")
    parser.add_argument("--data-dir", default="web/data/live", help="輸出目錄（預設 web/data/live）")
    args = parser.parse_args()

    input_path = Path(args.input)
    data_dir = Path(args.data_dir)
    rows = load_rows(input_path)
    if not rows:
        print("[WARN] 找不到可匯入的資料列。")
        return 1

    stations = get_builtin_stations_dict()
    st_file = data_dir / "stations.json"
    existing_st = read_json(st_file, {})
    if isinstance(existing_st.get("stations"), dict):
        stations.update(existing_st["stations"])

    by_date: dict[str, dict[str, dict]] = {}
    for row in rows:
        sid = str(row.get("StationID") or row.get("station_id") or "").strip()
        train_no = str(row.get("TrainNo") or row.get("train_no") or "").strip()
        if not sid or not train_no:
            continue

        upd = str(row.get("UpdateTime") or row.get("UpdateDate") or row.get("Date") or args.date).strip()
        date_str = upd[:10] if len(upd) >= 10 and upd[4:5] == "-" else args.date
        if not date_str:
            continue

        sch = str(
            row.get("ScheduleDepartureTime")
            or row.get("ScheduleArrivalTime")
            or row.get("schedule_time")
            or "12:00"
        )[:5]
        try:
            delay = max(0, int(float(row.get("DelayTime") or row.get("delay") or 0)))
        except Exception:
            delay = 0

        dir_str = "1" if str(row.get("Direction") or "0") == "1" else "0"
        train_type = normalize_train_type(
            extract_zh(row.get("TrainTypeName") or row.get("train_type")),
            str(row.get("TrainTypeCode") or ""),
        )
        end_st = extract_zh(row.get("EndingStationName") or row.get("ending_station"))
        st_name = extract_zh(row.get("StationName")) or stations.get(sid, {}).get("name", sid)

        by_date.setdefault(date_str, {})[f"{sid}|{train_no}|{sch}"] = {
            "s": sid,
            "sn": st_name,
            "t": train_no,
            "d": delay,
            "dir": dir_str,
            "type": train_type,
            "end": end_st,
            "sch": sch,
            "can": str(row.get("RunningStatus", "")).lower() in ("2", "cancel", "cancelled"),
            "upd": upd,
        }

    now = now_taipei()
    daily_dir = data_dir / "daily"
    monthly_dir = data_dir / "monthly"
    yearly_dir = data_dir / "yearly"

    months: set[str] = set()
    years: set[str] = set()

    for date_str, rec_map in sorted(by_date.items()):
        daily_doc = build_daily_aggregate(date_str, rec_map, stations, now)
        write_json(daily_dir / f"{date_str}.json", daily_doc)
        months.add(date_str[:7])
        years.add(date_str[:4])

    for m in sorted(months):
        docs = [read_json(p, None) for p in sorted(daily_dir.glob(f"{m}-*.json"))]
        docs = [d for d in docs if d]
        if docs:
            yy, mm = m.split("-")
            write_json(monthly_dir / f"{m}.json", merge_period_files("monthly", m, f"{yy} 年 {int(mm):02d} 月", docs, now))

    for y in sorted(years):
        docs = [read_json(p, None) for p in sorted(monthly_dir.glob(f"{y}-*.json"))]
        docs = [d for d in docs if d]
        if docs:
            write_json(yearly_dir / f"{y}.json", merge_period_files("yearly", y, f"{y} 年度", docs, now))

    avail_d = sorted([p.stem for p in daily_dir.glob("*.json")], reverse=True)
    avail_m = sorted([p.stem for p in monthly_dir.glob("*.json")], reverse=True)
    avail_y = sorted([p.stem for p in yearly_dir.glob("*.json")], reverse=True)

    prev = read_json(data_dir / "manifest.json", {})
    prev.update(
        {
            "source": "live",
            "generated_at": now.isoformat(timespec="seconds"),
            "scope": prev.get("scope", "all"),
            "station_count": len(stations),
            "available": {"daily": avail_d, "monthly": avail_m, "yearly": avail_y},
            "latest": {
                "daily": avail_d[0] if avail_d else None,
                "monthly": avail_m[0] if avail_m else None,
                "yearly": avail_y[0] if avail_y else None,
            },
        }
    )
    write_json(data_dir / "manifest.json", prev)
    print(f"[DONE] 成功匯入 {len(by_date)} 天歷史資料（影響 {len(months)} 個月、{len(years)} 個年度）。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
