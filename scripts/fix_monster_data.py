"""
Fix monsters_detail.json using authoritative LCX data.

Issues found:
1. 25 monsters have wrong dex_number (large auto-generated numbers instead of correct LCX numbers)
2. 32 异色S2 variants from LCX are missing from current data
3. Some trait descriptions may differ between LCX and current data

This script:
- Fixes dex_number for mismatched monsters
- Adds missing 异色S2 variant entries
- Keeps existing move_pool data intact
- Validates all stats against LCX authoritative source
"""
import json
import copy
import sys

ROOT = r"E:\洛克王国相关"
LCX_SPECIES_PATH = ROOT + r"\pvp相关信息\精灵与技能全图鉴\lcx_tujian_species_text.json"
CUR_MONSTERS_PATH = ROOT + r"\roco-pvp-app\src\data\monsters_detail.json"
OUTPUT_PATH = ROOT + r"\roco-pvp-app\src\data\monsters_detail_fixed.json"

# ── Type mapping ──
TYPE_MAP = {
    "普通": {"id": 1, "name": "Normal", "localized": {"zh": "普通"}},
    "草": {"id": 2, "name": "Grass", "localized": {"zh": "草"}},
    "火": {"id": 3, "name": "Fire", "localized": {"zh": "火"}},
    "水": {"id": 4, "name": "Water", "localized": {"zh": "水"}},
    "光": {"id": 5, "name": "Light", "localized": {"zh": "光"}},
    "电": {"id": 6, "name": "Electric", "localized": {"zh": "电"}},
    "地": {"id": 7, "name": "Ground", "localized": {"zh": "地"}},
    "冰": {"id": 8, "name": "Ice", "localized": {"zh": "冰"}},
    "毒": {"id": 9, "name": "Poison", "localized": {"zh": "毒"}},
    "虫": {"id": 10, "name": "Bug", "localized": {"zh": "虫"}},
    "武": {"id": 11, "name": "Fighting", "localized": {"zh": "武"}},
    "龙": {"id": 12, "name": "Dragon", "localized": {"zh": "龙"}},
    "翼": {"id": 13, "name": "Flying", "localized": {"zh": "翼"}},
    "萌": {"id": 14, "name": "Cute", "localized": {"zh": "萌"}},
    "幽": {"id": 15, "name": "Ghost", "localized": {"zh": "幽"}},
    "恶": {"id": 16, "name": "Dark", "localized": {"zh": "恶"}},
    "机械": {"id": 17, "name": "Mechanical", "localized": {"zh": "机械"}},
    "幻": {"id": 18, "name": "Illusion", "localized": {"zh": "幻"}},
}

def base_name(name):
    """Remove 异色S2 suffix to get base name."""
    return name.replace("异色S2", "").strip()

def parse_types(attr_str):
    """Parse '水,萌' -> (main_type, sub_type_or_None)."""
    parts = [p.strip() for p in attr_str.split(",")]
    main = TYPE_MAP.get(parts[0])
    if main is None:
        print(f"WARNING: Unknown type '{parts[0]}'")
        main = TYPE_MAP["普通"]
    sub = None
    if len(parts) > 1:
        sub = TYPE_MAP.get(parts[1])
        if sub is None:
            print(f"WARNING: Unknown sub type '{parts[1]}'")
    return copy.deepcopy(main), copy.deepcopy(sub)

def parse_trait(ability_str):
    """Parse '留学生：自己全技能能耗+2，可以学习全部攻击技能石。' -> Trait object."""
    # Split on first ：or :
    if "：" in ability_str:
        name, desc = ability_str.split("：", 1)
    elif ":" in ability_str:
        name, desc = ability_str.split(":", 1)
    else:
        name = ability_str
        desc = ability_str
    name = name.strip()
    desc = desc.strip()
    return {
        "id": 0,
        "name": name,
        "description": desc,
        "localized": {"zh": {"name": name, "description": desc}},
        "allows_duplicate_moves": None,
    }

def determine_attack_style(main_type, atk, spa):
    """Determine preferred attack style based on stats."""
    if atk > spa * 1.15:
        return "Physical"
    elif spa > atk * 1.15:
        return "Magic"
    else:
        return "Both"

def is_leader_form(name):
    """Check if this is a leader/boss form."""
    return "异色S2" in name

def build_lcx_lookup(lcx_data):
    """Build lookup: base_name -> list of LCX entries (multiple for variants)."""
    lookup = {}
    for s in lcx_data:
        bn = base_name(s["name"])
        if bn not in lookup:
            lookup[bn] = []
        lookup[bn].append(s)
    return lookup

def main():
    with open(LCX_SPECIES_PATH, "r", encoding="utf-8") as f:
        lcx_data = json.load(f)
    with open(CUR_MONSTERS_PATH, "r", encoding="utf-8") as f:
        cur_data = json.load(f)

    lcx_lookup = build_lcx_lookup(lcx_data)

    # Build current lookup by base name
    cur_by_basename = {}
    cur_by_id = {}
    for c in cur_data:
        cn = c.get("localized", {}).get("zh", {}).get("name", "")
        bn = base_name(cn)
        if bn not in cur_by_basename:
            cur_by_basename[bn] = []
        cur_by_basename[bn].append(c)
        cur_by_id[c["id"]] = c

    # ── Track fixes ──
    fixes = []
    variants_added = []

    # Find max existing ID to assign new IDs
    max_id = max(c["id"] for c in cur_data)

    # ── Step 1: Fix dex_numbers ──
    for bn, lcx_entries in lcx_lookup.items():
        if bn not in cur_by_basename:
            continue

        cur_entries = cur_by_basename[bn]

        # For each LCX entry, find matching current entry
        for lcx_entry in lcx_entries:
            lcx_no = int(lcx_entry["no"])
            lcx_name = lcx_entry["name"]

            # Find matching current entry (same base name, matching variant status or not)
            is_lcx_s2 = "异色S2" in lcx_name

            matched = False
            for cur_entry in cur_entries:
                cur_name = cur_entry.get("localized", {}).get("zh", {}).get("name", "")
                cur_is_s2 = "异色S2" in cur_name

                if is_lcx_s2 == cur_is_s2:
                    # Check if dex_number needs fixing
                    old_dex = cur_entry.get("dex_number", 0)
                    if old_dex != lcx_no:
                        fixes.append(f"dex_number: {cur_name} ({old_dex} -> {lcx_no})")
                        cur_entry["dex_number"] = lcx_no
                    matched = True
                    break

            if not matched and is_lcx_s2:
                # This 异色S2 variant is missing - need to add it
                # Find the base entry (non-S2) to copy move_pool from
                base_entry = None
                for cur_entry in cur_entries:
                    cur_name = cur_entry.get("localized", {}).get("zh", {}).get("name", "")
                    if "异色S2" not in cur_name:
                        base_entry = cur_entry
                        break

                if base_entry:
                    max_id += 1
                    main_type, sub_type = parse_types(lcx_entry["attributes"])
                    new_entry = {
                        "id": max_id,
                        "name": lcx_name,
                        "main_type": main_type,
                        "sub_type": sub_type,
                        "default_legacy_type": main_type,
                        "leader_potential": False,
                        "is_leader_form": is_leader_form(lcx_name),
                        "preferred_attack_style": determine_attack_style(
                            main_type,
                            lcx_entry["attack"],
                            lcx_entry["special_attack"]
                        ),
                        "localized": {"zh": {"name": lcx_name}},
                        "base_hp": lcx_entry["hp"],
                        "base_phy_atk": lcx_entry["attack"],
                        "base_mag_atk": lcx_entry["special_attack"],
                        "base_phy_def": lcx_entry["defense"],
                        "base_mag_def": lcx_entry["special_defense"],
                        "base_spd": lcx_entry["speed"],
                        "evolves_from_id": base_entry.get("evolves_from_id"),
                        "dex_number": lcx_no,
                        "trait": parse_trait(lcx_entry["ability"]),
                        "move_pool": copy.deepcopy(base_entry.get("move_pool", [])),
                    }
                    # Copy species if present
                    if "species" in base_entry:
                        new_entry["species"] = copy.deepcopy(base_entry["species"])

                    cur_data.append(new_entry)
                    variants_added.append(f"+ S2 variant: {lcx_name} (dex={lcx_no})")
                    if bn not in cur_by_basename:
                        cur_by_basename[bn] = []
                    cur_by_basename[bn].append(new_entry)
                else:
                    print(f"WARNING: No base entry found for S2 variant {lcx_name}, skipping")

    # ── Step 2: Validate stats match LCX ──
    stat_mismatches = []
    for c in cur_data:
        cn = c.get("localized", {}).get("zh", {}).get("name", "")
        bn = base_name(cn)
        lcx_entries = lcx_lookup.get(bn, [])

        # Find matching LCX entry
        is_s2 = "异色S2" in cn
        for le in lcx_entries:
            le_is_s2 = "异色S2" in le["name"]
            if is_s2 == le_is_s2:
                # Check stats
                stats_ok = True
                if c["base_hp"] != le["hp"]:
                    stat_mismatches.append(f"{cn}: HP {c['base_hp']} -> {le['hp']}")
                    c["base_hp"] = le["hp"]
                    stats_ok = False
                if c["base_phy_atk"] != le["attack"]:
                    stat_mismatches.append(f"{cn}: Atk {c['base_phy_atk']} -> {le['attack']}")
                    c["base_phy_atk"] = le["attack"]
                    stats_ok = False
                if c["base_mag_atk"] != le["special_attack"]:
                    stat_mismatches.append(f"{cn}: SpA {c['base_mag_atk']} -> {le['special_attack']}")
                    c["base_mag_atk"] = le["special_attack"]
                    stats_ok = False
                if c["base_phy_def"] != le["defense"]:
                    stat_mismatches.append(f"{cn}: Def {c['base_phy_def']} -> {le['defense']}")
                    c["base_phy_def"] = le["defense"]
                    stats_ok = False
                if c["base_mag_def"] != le["special_defense"]:
                    stat_mismatches.append(f"{cn}: SpD {c['base_mag_def']} -> {le['special_defense']}")
                    c["base_mag_def"] = le["special_defense"]
                    stats_ok = False
                if c["base_spd"] != le["speed"]:
                    stat_mismatches.append(f"{cn}: Spe {c['base_spd']} -> {le['speed']}")
                    c["base_spd"] = le["speed"]
                    stats_ok = False
                break

    # ── Output summary ──
    print(f"=== Data Fix Summary ===")
    print(f"Total current entries before fix: {len(cur_data) - len(variants_added)}")
    print(f"dex_number fixes: {len(fixes)}")
    for f in fixes:
        print(f"  {f}")
    print(f"S2 variants added: {len(variants_added)}")
    for v in variants_added:
        print(f"  {v}")
    print(f"Stat mismatches fixed: {len(stat_mismatches)}")
    for s in stat_mismatches:
        print(f"  {s}")
    print(f"Total entries after fix: {len(cur_data)}")

    # ── Save ──
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(cur_data, f, ensure_ascii=False, indent=2)
    print(f"\nSaved fixed data to: {OUTPUT_PATH}")

if __name__ == "__main__":
    main()
