"""Convert B站 9of10 recommendations to app data format."""
import json, re

ROOT = r"E:\洛克王国相关"
SRC = ROOT + r"\pvp相关信息\精灵与技能全图鉴\pvp_work\bilibili_9of10_final\recommendations_merged.json"
DETAIL = ROOT + r"\roco-pvp-app\src\data\monsters_detail.json"
OUT_MARKS = ROOT + r"\roco-pvp-app\src\data\popular_stat_marks.json"

with open(SRC, "r", encoding="utf-8") as f:
    bilibili = json.load(f)
with open(DETAIL, "r", encoding="utf-8") as f:
    monsters = json.load(f)

# Build name → id lookup
name_to_id = {}
for m in monsters:
    bn = m["localized"]["zh"]["name"]
    name_to_id[bn] = m["id"]
    # Also index by base name (before （)
    if "（" in bn:
        base = bn[:bn.index("（")]
        name_to_id[base] = m["id"]

# Map B站 stat names to our stat keys
STAT_MAP = {
    "生命": "hp", "体力": "hp",
    "物攻": "physicalAttack", "攻击": "physicalAttack",
    "魔攻": "magicalAttack", "特攻": "magicalAttack",
    "物防": "physicalDefense", "防御": "physicalDefense",
    "魔防": "magicalDefense", "特防": "magicalDefense",
    "速度": "speed",
}

# Map B站 personality names to our personality system
PERSONALITY_MAP = {
    "开朗": {"plusStats": ["speed"], "minusStat": "magicalAttack", "extremeStat": "speed"},
    "固执": {"plusStats": ["physicalAttack"], "minusStat": "magicalAttack", "extremeStat": "physicalAttack"},
    "勇敢": {"plusStats": ["physicalAttack"], "minusStat": "speed", "extremeStat": "physicalAttack"},
    "保守": {"plusStats": ["magicalAttack"], "minusStat": "physicalAttack", "extremeStat": "magicalAttack"},
    "胆小": {"plusStats": ["speed"], "minusStat": "physicalAttack", "extremeStat": "speed"},
    "沉着": {"plusStats": ["magicalDefense"], "minusStat": "physicalAttack", "extremeStat": "magicalDefense"},
    "大胆": {"plusStats": ["physicalDefense"], "minusStat": "physicalAttack", "extremeStat": "physicalDefense"},
    "淘气": {"plusStats": ["physicalDefense"], "minusStat": "magicalAttack", "extremeStat": "physicalDefense"},
    "慎重": {"plusStats": ["magicalDefense"], "minusStat": "magicalAttack", "extremeStat": "magicalDefense"},
    "马虎": {"plusStats": ["magicalAttack"], "minusStat": "magicalDefense", "extremeStat": "magicalAttack"},
    "温顺": {"plusStats": ["magicalDefense"], "minusStat": "physicalDefense", "extremeStat": "magicalDefense"},
    "急躁": {"plusStats": ["speed"], "minusStat": "physicalDefense", "extremeStat": "speed"},
    "天真": {"plusStats": ["speed"], "minusStat": "magicalDefense", "extremeStat": "speed"},
}

result = {}
matched = 0
for entry in bilibili:
    name = entry.get("name", "")
    b_no = entry.get("no", "")

    # Find matching monster
    monster_id = name_to_id.get(name)
    if not monster_id:
        # Try partial match
        for bn, mid in name_to_id.items():
            if name in bn or bn in name:
                monster_id = mid
                break

    if not monster_id:
        print(f"SKIP: {name} (#{b_no}) - not in DB")
        continue

    # Parse IV recommendations
    iv_raw = entry.get("iv_auto", "")
    plus_stats = []
    minus_stat = ""
    extreme_stat = ""

    # Pattern: "生命+魔攻+速度/物防/魔防" → first 3 are plus, rest are alternatives
    if iv_raw:
        parts = iv_raw.replace("+", " ").replace("/", " ").split()
        for p in parts:
            if p in STAT_MAP:
                eng = STAT_MAP[p]
                if len(plus_stats) < 3:
                    plus_stats.append(eng)
        if len(plus_stats) >= 3:
            extreme_stat = plus_stats[0]  # First listed is primary

    # Get personality
    nature = entry.get("nature_auto", "")
    pers_info = PERSONALITY_MAP.get(nature)
    if pers_info:
        # Use B站 personality's minus stat
        minus_stat = pers_info["minusStat"]
        extreme_stat = pers_info["extremeStat"]
    else:
        # Default: minus the stat not in plus_stats
        all_stats = ["physicalAttack", "magicalAttack", "physicalDefense", "magicalDefense", "speed"]
        for s in all_stats:
            if s not in plus_stats:
                minus_stat = s
                break

    str_id = str(monster_id)
    result[str_id] = {
        "extremeStat": extreme_stat,
        "plusStats": plus_stats[:3] if len(plus_stats) > 3 else plus_stats,
        "minusStat": minus_stat,
    }
    matched += 1

with open(OUT_MARKS, "w", encoding="utf-8") as f:
    json.dump(result, f, ensure_ascii=False, indent=2)

print(f"Matched {matched}/{len(bilibili)} monsters")
print(f"Output: {OUT_MARKS} ({len(result)} entries)")
