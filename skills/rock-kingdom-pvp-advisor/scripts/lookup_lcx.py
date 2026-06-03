from __future__ import annotations

import argparse
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "references" / "data"
SKILLS = DATA / "lcx_skill_text.json"
SPECIES = DATA / "lcx_tujian_species_text.json"


def load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def match_items(items, query: str, fields: list[str], limit: int):
    query = query.strip().lower()
    found = []
    for item in items:
        hay = " ".join(str(item.get(field, "")) for field in fields).lower()
        if query in hay:
            found.append(item)
        if len(found) >= limit:
            break
    return found


def main():
    parser = argparse.ArgumentParser(description="Lookup local LCX skill/species data.")
    parser.add_argument("kind", choices=["skill", "species", "both"])
    parser.add_argument("query")
    parser.add_argument("--limit", type=int, default=8)
    args = parser.parse_args()

    output = {}
    if args.kind in ("skill", "both"):
        output["skills"] = match_items(
            load(SKILLS),
            args.query,
            ["name", "attribute", "category", "energy", "power", "description"],
            args.limit,
        )
    if args.kind in ("species", "both"):
        output["species"] = match_items(
            load(SPECIES),
            args.query,
            ["no", "name", "attributes", "total", "ability", "hp", "attack", "defense", "magic_attack", "magic_defense", "speed"],
            args.limit,
        )
    print(json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
