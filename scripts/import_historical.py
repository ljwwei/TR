#!/usr/bin/env python3
"""
TDX 歷史資料匯入工具（支援 TDX 會員中心「臺鐵列車到離站電子看板歷史資料」CSV / JSON 單檔或整個資料夾）

使用方式：
  python scripts/import_historical.py --input path/to/folder_or_file --data-dir data_repo
"""

from __future__ import annotations

import argparse
import csv
import json
from datetime import datetime
from pathlib import Path

from collect_tdx import (
    build_daily_aggregate,
    merge_period_files,
    now_taipei,
    read_json,
    resolve_service_date_and_offset,
    write_json,
)
from stations_catalog import get_builtin_stations_dict, normalize_train_type


def iter_input_files(input_path: Path) -> list[Path]:
    if input_path.is_dir():
        return sorted(
            p for p in input_path.rglob("*")
            if p.is_file() and p.suffix.lower() in (".csv", ".json")
        )
    return [input_path]


def load_rows(file_path: Path):
    if file_path.suffix.lower() == ".csv":
        with file_path.open("r", encoding="utf-8-sig", newline="") as f:
            yield from csv.DictReader(f)
        return
    with file_path.open("r", encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, dict):
        for key in ("StationLiveBoards", "TrainLiveBoards", "Records", "data"):
            if isinstance(data.get(key), list):
                yield from data[key]
                return
    elif isinstance(data, list):
        yield from data


def extract_zh(val) -> str:
    if isinstance(val, dict):
        return (val.get("Zh_tw") or val.get("En") or "").strip()
    return str(val or "").strip()


def parse_direction(val) -> str:
    s = str(val or "").strip()
    if s in ("1", "逆行", "南下"):
        return "1"
    return "0"


def main() -> int:
    parser = argparse.ArgumentParser(description="批次匯入 TDX 臺鐵電子看板歷史資料至靜態資料目錄")
    parser.add_argument("--input", required=True, help="TDX 歷史資料檔或資料夾路徑（.csv / .json）")
    parser.add_argument("--date", default="", help="預設日期 YYYY-MM-DD（若資料未帶日期欄位時使用）")
    parser.add_argument("--data-dir", default="web/data/live", help="輸出目錄（預設 web/data/live）")
    args = parser.parse_args()

    input_path = Path(args.input)
    data_dir = Path(args.data_dir)
    files = iter_input_files(input_path)
    if not files:
        print("[WARN] 找不到可匯入的 CSV/JSON 檔案。")
        return 1

    stations = get_builtin_stations_dict()
    st_file = data_dir / "stations.json"
    existing_st = read_json(st_file, {})
    if isinstance(existing_st.get("stations"), dict):
        stations.update(existing_st["stations"])

    by_date: dict[str, dict[str, dict]] = {}
    for fp in files:
        print(f"[INFO] 讀取 {fp.name} …")
        for row in load_rows(fp):
            sid = str(row.get("StationID") or row.get("station_id") or "").strip()
            train_no = str(row.get("TrainNo") or row.get("train_no") or "").strip()
            if not sid or not train_no:
                continue

            upd = str(
                row.get("UpdateTime")
                or row.get("SrcUpdateTime")
                or row.get("UpdateDate")
                or row.get("Date")
                or args.date
            ).strip()
            sch_raw = str(
                row.get("ScheduledDepartureTime")
                or row.get("ScheduleDepartureTime")
                or row.get("ScheduledArrivalTime")
                or row.get("ScheduleArrivalTime")
                or row.get("schedule_time")
                or "12:00"
            ).strip()
            sch = sch_raw[:5] if len(sch_raw) >= 5 else "12:00"

            try:
                delay = max(0, int(float(row.get("DelayTime") or row.get("delay") or 0)))
            except Exception:
                delay = 0

            cancelled = str(row.get("RunningStatus", "")).lower() in ("2", "cancel", "cancelled")

            date_str = upd[:10] if len(upd) >= 10 and upd[4:5] == "-" else args.date
            if len(upd) >= 19 and "T" in upd:
                try:
                    upd_dt = datetime.fromisoformat(upd)
                    date_str, diff_min = resolve_service_date_and_offset(upd_dt, sch)
                    if diff_min > 35 and delay == 0 and not cancelled:
                        continue
                    if diff_min < -120 and delay == 0 and not cancelled:
                        continue
                except Exception:
                    pass
            if not date_str:
                continue

            dir_str = parse_direction(row.get("Direction"))
            train_type = normalize_train_type(
                extract_zh(row.get("TrainTypeNameZh_tw") or row.get("TrainTypeName") or row.get("train_type")),
                str(row.get("TrainTypeCode") or row.get("TrainTypeID") or ""),
            )
            end_st = extract_zh(
                row.get("EndingStationNameZh_tw")
                or row.get("EndingStationName")
                or row.get("ending_station")
            )
            st_name = (
                extract_zh(row.get("StationNameZh_tw") or row.get("StationName"))
                or stations.get(sid, {}).get("name", sid)
            )

            day_map = by_date.setdefault(date_str, {})
            obs_key = f"{sid}|{train_no}|{sch}"
            prev = day_map.get(obs_key)
            if prev is None or upd >= prev.get("upd", ""):
                day_map[obs_key] = {
                    "s": sid,
                    "sn": st_name,
                    "t": train_no,
                    "d": delay,
                    "dir": dir_str,
                    "type": train_type,
                    "end": end_st,
                    "sch": sch,
                    "can": cancelled,
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
            "generated_at": prev.get("generated_at") or now.isoformat(timespec="seconds"),
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
