"""
臺灣鐵路（TRA）車站基本資料與台灣本島 19 縣市代表車站清單。
使用 TDX v3 / 臺鐵第四代票務系統四碼車站代碼（StationID）。
"""

from __future__ import annotations

# 台灣本島 19 縣市最主要代表車站（每縣市 1 座核心車站）
MAJOR_COUNTY_STATIONS: list[dict] = [
    {"id": "0900", "name": "基隆", "en": "Keelung", "city": "基隆市", "region": "北部", "line": "縱貫線北段", "lat": 25.1341, "lon": 121.7399, "class": "1", "is_major": True},
    {"id": "1000", "name": "臺北", "en": "Taipei", "city": "臺北市", "region": "北部", "line": "縱貫線北段", "lat": 25.0478, "lon": 121.5171, "class": "0", "is_major": True},
    {"id": "1020", "name": "板橋", "en": "Banqiao", "city": "新北市", "region": "北部", "line": "縱貫線北段", "lat": 25.0143, "lon": 121.4637, "class": "1", "is_major": True},
    {"id": "1080", "name": "桃園", "en": "Taoyuan", "city": "桃園市", "region": "北部", "line": "縱貫線北段", "lat": 24.9892, "lon": 121.3135, "class": "1", "is_major": True},
    {"id": "1180", "name": "竹北", "en": "Zhubei", "city": "新竹縣", "region": "北部", "line": "縱貫線北段", "lat": 24.8390, "lon": 121.0093, "class": "3", "is_major": True},
    {"id": "1210", "name": "新竹", "en": "Hsinchu", "city": "新竹市", "region": "北部", "line": "縱貫線北段", "lat": 24.8017, "lon": 120.9716, "class": "1", "is_major": True},
    {"id": "3160", "name": "苗栗", "en": "Miaoli", "city": "苗栗縣", "region": "中部", "line": "臺中線(山線)", "lat": 24.5700, "lon": 120.8224, "class": "1", "is_major": True},
    {"id": "3300", "name": "臺中", "en": "Taichung", "city": "臺中市", "region": "中部", "line": "臺中線(山線)", "lat": 24.1368, "lon": 120.6850, "class": "0", "is_major": True},
    {"id": "3360", "name": "彰化", "en": "Changhua", "city": "彰化縣", "region": "中部", "line": "山海線交會", "lat": 24.0816, "lon": 120.5385, "class": "1", "is_major": True},
    {"id": "3432", "name": "濁水", "en": "Zhuoshui", "city": "南投縣", "region": "中部", "line": "集集支線", "lat": 23.8347, "lon": 120.7048, "class": "4", "is_major": True},
    {"id": "3470", "name": "斗六", "en": "Douliu", "city": "雲林縣", "region": "中部", "line": "縱貫線南段", "lat": 23.7118, "lon": 120.5411, "class": "1", "is_major": True},
    {"id": "4060", "name": "民雄", "en": "Minxiong", "city": "嘉義縣", "region": "南部", "line": "縱貫線南段", "lat": 23.5551, "lon": 120.4316, "class": "3", "is_major": True},
    {"id": "4080", "name": "嘉義", "en": "Chiayi", "city": "嘉義市", "region": "南部", "line": "縱貫線南段", "lat": 23.4791, "lon": 120.4411, "class": "1", "is_major": True},
    {"id": "4220", "name": "臺南", "en": "Tainan", "city": "臺南市", "region": "南部", "line": "縱貫線南段", "lat": 22.9971, "lon": 120.2129, "class": "1", "is_major": True},
    {"id": "4400", "name": "高雄", "en": "Kaohsiung", "city": "高雄市", "region": "南部", "line": "縱貫線/屏東線", "lat": 22.6396, "lon": 120.3021, "class": "0", "is_major": True},
    {"id": "5000", "name": "屏東", "en": "Pingtung", "city": "屏東縣", "region": "南部", "line": "屏東線", "lat": 22.6693, "lon": 120.4862, "class": "1", "is_major": True},
    {"id": "6000", "name": "臺東", "en": "Taitung", "city": "臺東縣", "region": "東部", "line": "臺東線/南迴線", "lat": 22.7937, "lon": 121.1232, "class": "1", "is_major": True},
    {"id": "7000", "name": "花蓮", "en": "Hualien", "city": "花蓮縣", "region": "東部", "line": "北迴線/臺東線", "lat": 23.9929, "lon": 121.6011, "class": "0", "is_major": True},
    {"id": "7190", "name": "宜蘭", "en": "Yilan", "city": "宜蘭縣", "region": "東部", "line": "宜蘭線", "lat": 24.7544, "lon": 121.7582, "class": "1", "is_major": True},
]

# 其他全臺重要幹線與轉乘車站（即時串接 TDX 後會自動擴充至全臺 240+ 站）
ADDITIONAL_STATIONS: list[dict] = [
    {"id": "0920", "name": "八堵", "en": "Badu", "city": "基隆市", "region": "北部", "line": "縱貫線北段", "lat": 25.1084, "lon": 121.7290, "class": "2", "is_major": False},
    {"id": "0930", "name": "七堵", "en": "Qidu", "city": "基隆市", "region": "北部", "line": "縱貫線北段", "lat": 25.0928, "lon": 121.7141, "class": "1", "is_major": False},
    {"id": "0960", "name": "汐止", "en": "Xizhi", "city": "新北市", "region": "北部", "line": "縱貫線北段", "lat": 25.0681, "lon": 121.6612, "class": "2", "is_major": False},
    {"id": "0980", "name": "南港", "en": "Nangang", "city": "臺北市", "region": "北部", "line": "縱貫線北段", "lat": 25.0532, "lon": 121.6071, "class": "1", "is_major": False},
    {"id": "0990", "name": "松山", "en": "Songshan", "city": "臺北市", "region": "北部", "line": "縱貫線北段", "lat": 25.0493, "lon": 121.5782, "class": "1", "is_major": False},
    {"id": "1010", "name": "萬華", "en": "Wanhua", "city": "臺北市", "region": "北部", "line": "縱貫線北段", "lat": 25.0333, "lon": 121.5002, "class": "1", "is_major": False},
    {"id": "1040", "name": "樹林", "en": "Shulin", "city": "新北市", "region": "北部", "line": "縱貫線北段", "lat": 24.9911, "lon": 121.4243, "class": "1", "is_major": False},
    {"id": "1070", "name": "鶯歌", "en": "Yingge", "city": "新北市", "region": "北部", "line": "縱貫線北段", "lat": 24.9545, "lon": 121.3551, "class": "2", "is_major": False},
    {"id": "1100", "name": "中壢", "en": "Zhongli", "city": "桃園市", "region": "北部", "line": "縱貫線北段", "lat": 24.9537, "lon": 121.2257, "class": "1", "is_major": False},
    {"id": "1120", "name": "楊梅", "en": "Yangmei", "city": "桃園市", "region": "北部", "line": "縱貫線北段", "lat": 24.9141, "lon": 121.1462, "class": "3", "is_major": False},
    {"id": "1160", "name": "湖口", "en": "Hukou", "city": "新竹縣", "region": "北部", "line": "縱貫線北段", "lat": 24.9027, "lon": 121.0442, "class": "3", "is_major": False},
    {"id": "1170", "name": "新豐", "en": "Xinfeng", "city": "新竹縣", "region": "北部", "line": "縱貫線北段", "lat": 24.8693, "lon": 120.9967, "class": "3", "is_major": False},
    {"id": "1250", "name": "竹南", "en": "Zhunan", "city": "苗栗縣", "region": "中部", "line": "山海線交會", "lat": 24.6865, "lon": 120.8809, "class": "1", "is_major": False},
    {"id": "2130", "name": "後龍", "en": "Houlong", "city": "苗栗縣", "region": "中部", "line": "海岸線(海線)", "lat": 24.6162, "lon": 120.7873, "class": "3", "is_major": False},
    {"id": "2170", "name": "通霄", "en": "Tongxiao", "city": "苗栗縣", "region": "中部", "line": "海岸線(海線)", "lat": 24.4894, "lon": 120.6784, "class": "3", "is_major": False},
    {"id": "2200", "name": "大甲", "en": "Dajia", "city": "臺中市", "region": "中部", "line": "海岸線(海線)", "lat": 24.3444, "lon": 120.6270, "class": "2", "is_major": False},
    {"id": "2220", "name": "清水", "en": "Qingshui", "city": "臺中市", "region": "中部", "line": "海岸線(海線)", "lat": 24.2636, "lon": 120.5692, "class": "3", "is_major": False},
    {"id": "2230", "name": "沙鹿", "en": "Shalu", "city": "臺中市", "region": "中部", "line": "海岸線(海線)", "lat": 24.2370, "lon": 120.5575, "class": "2", "is_major": False},
    {"id": "3230", "name": "豐原", "en": "Fengyuan", "city": "臺中市", "region": "中部", "line": "臺中線(山線)", "lat": 24.2541, "lon": 120.7229, "class": "1", "is_major": False},
    {"id": "3340", "name": "新烏日", "en": "Xinwuri", "city": "臺中市", "region": "中部", "line": "臺中線(山線)", "lat": 24.1095, "lon": 120.6143, "class": "2", "is_major": False},
    {"id": "3390", "name": "員林", "en": "Yuanlin", "city": "彰化縣", "region": "中部", "line": "縱貫線南段", "lat": 23.9594, "lon": 120.5699, "class": "1", "is_major": False},
    {"id": "3420", "name": "田中", "en": "Tianzhong", "city": "彰化縣", "region": "中部", "line": "縱貫線南段", "lat": 23.8585, "lon": 120.5914, "class": "2", "is_major": False},
    {"id": "3430", "name": "二水", "en": "Ershui", "city": "彰化縣", "region": "中部", "line": "縱貫線/集集線", "lat": 23.8132, "lon": 120.6181, "class": "2", "is_major": False},
    {"id": "3434", "name": "集集", "en": "Jiji", "city": "南投縣", "region": "中部", "line": "集集支線", "lat": 23.8265, "lon": 120.7849, "class": "4", "is_major": False},
    {"id": "3480", "name": "斗南", "en": "Dounan", "city": "雲林縣", "region": "中部", "line": "縱貫線南段", "lat": 23.6730, "lon": 120.4809, "class": "2", "is_major": False},
    {"id": "4050", "name": "大林", "en": "Dalin", "city": "嘉義縣", "region": "南部", "line": "縱貫線南段", "lat": 23.6010, "lon": 120.4559, "class": "3", "is_major": False},
    {"id": "4120", "name": "新營", "en": "Xinying", "city": "臺南市", "region": "南部", "line": "縱貫線南段", "lat": 23.3067, "lon": 120.3230, "class": "1", "is_major": False},
    {"id": "4170", "name": "善化", "en": "Shanhua", "city": "臺南市", "region": "南部", "line": "縱貫線南段", "lat": 23.1333, "lon": 120.3065, "class": "2", "is_major": False},
    {"id": "4200", "name": "永康", "en": "Yongkang", "city": "臺南市", "region": "南部", "line": "縱貫線南段", "lat": 23.0383, "lon": 120.2535, "class": "2", "is_major": False},
    {"id": "4272", "name": "沙崙", "en": "Shalun", "city": "臺南市", "region": "南部", "line": "沙崙支線", "lat": 22.9242, "lon": 120.2862, "class": "4", "is_major": False},
    {"id": "4310", "name": "岡山", "en": "Gangshan", "city": "高雄市", "region": "南部", "line": "縱貫線南段", "lat": 22.7921, "lon": 120.2999, "class": "1", "is_major": False},
    {"id": "4330", "name": "楠梓", "en": "Nanzi", "city": "高雄市", "region": "南部", "line": "縱貫線南段", "lat": 22.7269, "lon": 120.3243, "class": "2", "is_major": False},
    {"id": "4340", "name": "新左營", "en": "Xinzuoying", "city": "高雄市", "region": "南部", "line": "縱貫線南段", "lat": 22.6875, "lon": 120.3068, "class": "1", "is_major": False},
    {"id": "4440", "name": "鳳山", "en": "Fengshan", "city": "高雄市", "region": "南部", "line": "屏東線", "lat": 22.6315, "lon": 120.3578, "class": "2", "is_major": False},
    {"id": "5050", "name": "潮州", "en": "Chaozhou", "city": "屏東縣", "region": "南部", "line": "屏東線", "lat": 22.5501, "lon": 120.5360, "class": "1", "is_major": False},
    {"id": "5120", "name": "枋寮", "en": "Fangliao", "city": "屏東縣", "region": "南部", "line": "屏東線/南迴線", "lat": 22.3680, "lon": 120.5951, "class": "2", "is_major": False},
    {"id": "5190", "name": "大武", "en": "Dawu", "city": "臺東縣", "region": "東部", "line": "南迴線", "lat": 22.3653, "lon": 120.9009, "class": "3", "is_major": False},
    {"id": "5220", "name": "太麻里", "en": "Taimali", "city": "臺東縣", "region": "東部", "line": "南迴線", "lat": 22.6184, "lon": 121.0052, "class": "3", "is_major": False},
    {"id": "5230", "name": "知本", "en": "Zhiben", "city": "臺東縣", "region": "東部", "line": "南迴線", "lat": 22.7099, "lon": 121.0604, "class": "3", "is_major": False},
    {"id": "6050", "name": "關山", "en": "Guanshan", "city": "臺東縣", "region": "東部", "line": "臺東線", "lat": 23.0457, "lon": 121.1642, "class": "3", "is_major": False},
    {"id": "6070", "name": "池上", "en": "Chishang", "city": "臺東縣", "region": "東部", "line": "臺東線", "lat": 23.1262, "lon": 121.2194, "class": "3", "is_major": False},
    {"id": "6110", "name": "玉里", "en": "Yuli", "city": "花蓮縣", "region": "東部", "line": "臺東線", "lat": 23.3315, "lon": 121.3118, "class": "1", "is_major": False},
    {"id": "6140", "name": "瑞穗", "en": "Ruisui", "city": "花蓮縣", "region": "東部", "line": "臺東線", "lat": 23.4974, "lon": 121.3767, "class": "3", "is_major": False},
    {"id": "6160", "name": "光復", "en": "Guangfu", "city": "花蓮縣", "region": "東部", "line": "臺東線", "lat": 23.6663, "lon": 121.4212, "class": "3", "is_major": False},
    {"id": "6190", "name": "鳳林", "en": "Fenglin", "city": "花蓮縣", "region": "東部", "line": "臺東線", "lat": 23.7463, "lon": 121.4470, "class": "3", "is_major": False},
    {"id": "6220", "name": "壽豐", "en": "Shoufeng", "city": "花蓮縣", "region": "東部", "line": "臺東線", "lat": 23.8691, "lon": 121.5108, "class": "3", "is_major": False},
    {"id": "7030", "name": "新城", "en": "Xincheng", "city": "花蓮縣", "region": "東部", "line": "北迴線", "lat": 24.1277, "lon": 121.6408, "class": "2", "is_major": False},
    {"id": "7120", "name": "蘇澳新", "en": "Su'aoxin", "city": "宜蘭縣", "region": "東部", "line": "宜蘭線/北迴線", "lat": 24.6088, "lon": 121.8271, "class": "1", "is_major": False},
    {"id": "7160", "name": "羅東", "en": "Luodong", "city": "宜蘭縣", "region": "東部", "line": "宜蘭線", "lat": 24.6778, "lon": 121.7745, "class": "2", "is_major": False},
    {"id": "7210", "name": "礁溪", "en": "Jiaoxi", "city": "宜蘭縣", "region": "東部", "line": "宜蘭線", "lat": 24.8270, "lon": 121.7753, "class": "3", "is_major": False},
    {"id": "7220", "name": "頭城", "en": "Toucheng", "city": "宜蘭縣", "region": "東部", "line": "宜蘭線", "lat": 24.8590, "lon": 121.8226, "class": "3", "is_major": False},
    {"id": "7290", "name": "福隆", "en": "Fulong", "city": "新北市", "region": "北部", "line": "宜蘭線", "lat": 25.0160, "lon": 121.9447, "class": "3", "is_major": False},
    {"id": "7360", "name": "瑞芳", "en": "Ruifang", "city": "新北市", "region": "北部", "line": "宜蘭線/平溪線", "lat": 25.1089, "lon": 121.8062, "class": "1", "is_major": False},
]

MAJOR_STATION_IDS: set[str] = {s["id"] for s in MAJOR_COUNTY_STATIONS}
MAJOR_STATION_ORDER: list[str] = [s["id"] for s in MAJOR_COUNTY_STATIONS]

CITY_TO_REGION: dict[str, str] = {
    "基隆市": "北部",
    "臺北市": "北部",
    "台北市": "北部",
    "新北市": "北部",
    "桃園市": "北部",
    "新竹市": "北部",
    "新竹縣": "北部",
    "苗栗縣": "中部",
    "臺中市": "中部",
    "台中市": "中部",
    "彰化縣": "中部",
    "南投縣": "中部",
    "雲林縣": "中部",
    "嘉義市": "南部",
    "嘉義縣": "南部",
    "臺南市": "南部",
    "台南市": "南部",
    "高雄市": "南部",
    "屏東縣": "南部",
    "臺東縣": "東部",
    "台東縣": "東部",
    "花蓮縣": "東部",
    "宜蘭縣": "東部",
}


def normalize_city(city: str | None) -> str:
    if not city:
        return "其他"
    return city.replace("台", "臺").strip()


def infer_region(city: str | None, station_id: str = "") -> str:
    norm = normalize_city(city)
    if norm in CITY_TO_REGION:
        return CITY_TO_REGION[norm]
    if station_id:
        prefix = station_id[:1]
        if prefix in ("0", "1"):
            return "北部"
        if prefix in ("2", "3"):
            return "中部"
        if prefix in ("4", "5"):
            return "南部"
        if prefix in ("6", "7"):
            return "東部"
    return "北部"


def infer_line(station_id: str) -> str:
    try:
        sid = int(station_id)
    except ValueError:
        return "其他路線"
    if 900 <= sid <= 1250:
        return "縱貫線北段"
    if 1191 <= sid <= 1208:
        return "內灣/六家線"
    if 2110 <= sid <= 2260:
        return "海岸線(海線)"
    if 3140 <= sid <= 3350:
        return "臺中線(山線)"
    if 3360 <= sid <= 3430 or 3450 <= sid <= 4400:
        return "縱貫線南段"
    if 3431 <= sid <= 3436:
        return "集集支線"
    if 4271 <= sid <= 4272:
        return "沙崙支線"
    if 4410 <= sid <= 5120:
        return "屏東線"
    if 5130 <= sid <= 5240:
        return "南迴線"
    if 6000 <= sid <= 6250:
        return "臺東線"
    if 7000 <= sid <= 7110:
        return "北迴線"
    if 7120 <= sid <= 7390:
        return "宜蘭線"
    if 7331 <= sid <= 7336:
        return "平溪/深澳線"
    return "臺鐵支線"


def get_builtin_stations_dict() -> dict[str, dict]:
    catalog: dict[str, dict] = {}
    for entry in MAJOR_COUNTY_STATIONS + ADDITIONAL_STATIONS:
        catalog[entry["id"]] = dict(entry)
    return catalog


def normalize_train_type(name: str | None, code: str | None = None) -> str:
    raw = (name or "").strip()
    if "3000" in raw or "新自強" in raw:
        return "新自強(3000)"
    if "普悠瑪" in raw:
        return "普悠瑪"
    if "太魯閣" in raw:
        return "太魯閣"
    if "自強" in raw:
        return "自強號"
    if "莒光" in raw:
        return "莒光號"
    if "區間快" in raw:
        return "區間快"
    if "區間" in raw:
        return "區間車"
    if "復興" in raw:
        return "復興/觀光"
    if code:
        c = str(code).strip()
        if c == "1":
            return "太魯閣"
        if c == "2":
            return "普悠瑪"
        if c in ("3", "1100", "1101", "1102", "1103", "1107", "1108", "1109", "1110"):
            return "自強號"
        if c in ("4", "1120", "1121", "1122"):
            return "莒光號"
        if c in ("6", "1131"):
            return "區間車"
        if c in ("10", "1132"):
            return "區間快"
    return raw if raw else "其他車種"
