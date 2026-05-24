#!/usr/bin/env python3
"""
update_stages.py — Sync sweep stage drop data from soshage.com.

Fetches https://soshage.com/trickcal/zh-tw/stage, extracts SvelteKit SSR
stage data, finds equip drops for difficulty=1/mode=1 stages, and merges
new {chapter}-{stage_order} entries into public/sweep/data.json.
Also downloads missing equip icons to public/assets/gears/ with rarity
background compositing.

Usage:
    python scripts/updater/update_stages.py [--dry-run] [--skip-images]
"""

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

try:
    import requests
except ImportError:
    print(
        "ERROR: Missing deps. Run: .venv/Scripts/pip install -r requirements.txt",
        file=sys.stderr,
    )
    sys.exit(1)

from equip_image import download_equip_image, EQUIPICON_CDN, GEARS_DIR, SESSION, _RARITY_BG  # noqa: E402

SCRIPT_DIR = Path(__file__).parent.resolve()
PROJECT_ROOT = SCRIPT_DIR.parent.parent.resolve()
UPDATER_DIR = SCRIPT_DIR
SWEEP_JSON = PROJECT_ROOT / "public" / "sweep" / "data.json"
GEAR_DATA_JSON = PROJECT_ROOT / "public" / "gear" / "data.json"
MATERIAL_DATA_JSON = PROJECT_ROOT / "public" / "gear" / "material.json"
STAGE_URL = "https://soshage.com/trickcal/zh-tw/stage"


# ---------------------------------------------------------------------------
# JS → JSON converter (reused from update_units.py)
# ---------------------------------------------------------------------------

def _match_bracket(text: str, start: int, open_ch: str, close_ch: str) -> int:
    depth = 0
    in_str = False
    escape = False
    for i in range(start, len(text)):
        c = text[i]
        if escape:
            escape = False
            continue
        if c == "\\" and in_str:
            escape = True
            continue
        if c == '"' and not escape:
            in_str = not in_str
            continue
        if in_str:
            continue
        if c == open_ch:
            depth += 1
        elif c == close_ch:
            depth -= 1
            if depth == 0:
                return i
    return -1


def _js_to_json(js: str) -> str:
    out = []
    i = 0
    n = len(js)
    while i < n:
        c = js[i]
        if c == '"':
            out.append(c)
            i += 1
            while i < n:
                sc = js[i]
                out.append(sc)
                if sc == "\\":
                    i += 1
                    if i < n:
                        out.append(js[i])
                elif sc == '"':
                    i += 1
                    break
                i += 1
            continue
        if c in "{,":
            out.append(c)
            i += 1
            ws_start = i
            while i < n and js[i] in " \t\n\r":
                i += 1
            ws = js[ws_start:i]
            if i < n and (js[i].isalpha() or js[i] in "_$"):
                k_start = i
                while i < n and (js[i].isalnum() or js[i] in "_$"):
                    i += 1
                key = js[k_start:i]
                j = i
                while j < n and js[j] in " \t\n\r":
                    j += 1
                if j < n and js[j] == ":":
                    out.append(ws + '"' + key + '"')
                else:
                    out.append(ws + key)
            else:
                out.append(ws)
            continue
        out.append(c)
        i += 1
    result = "".join(out)
    result = re.sub(r"([:,\[{])\s*(-?)\.(\d)", lambda m: m.group(1) + m.group(2) + "0." + m.group(3), result)
    result = re.sub(r",(\s*[}\]])", r"\1", result)
    return result


# ---------------------------------------------------------------------------
# HTML extraction
# ---------------------------------------------------------------------------

def extract_stages_from_html(html: str) -> list[dict[str, Any]]:
    m = re.search(r'"?stages"?\s*:\s*\[', html)
    if not m:
        return []
    bracket_start = html.index("[", m.start())
    bracket_end = _match_bracket(html, bracket_start, "[", "]")
    if bracket_end == -1:
        return []
    stages_js = html[bracket_start : bracket_end + 1]
    stages_json_str = _js_to_json(stages_js)
    try:
        result = json.loads(stages_json_str)
        if isinstance(result, list):
            return result
    except json.JSONDecodeError as exc:
        pos = exc.pos or 0
        ctx = stages_json_str[max(0, pos - 60) : pos + 60]
        print(f"  WARNING: failed to parse stages at pos {pos}: {exc.msg}")
        print(f"  Context: ...{ctx!r}...")
    return []


def fetch_page(url: str, retries: int = 2, delay: int = 2) -> str | None:
    for attempt in range(retries):
        try:
            resp = SESSION.get(url, timeout=30)
            resp.raise_for_status()
            resp.encoding = "utf-8"
            return resp.text
        except Exception as exc:
            if attempt < retries - 1:
                print(f"    retry {attempt + 1}: {exc}")
            else:
                print(f"  WARNING: fetch failed: {exc}")
    return None


# ---------------------------------------------------------------------------
# JSON I/O
# ---------------------------------------------------------------------------

def load_json(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def save_json(path: Path, data: dict[str, Any]) -> None:
    with path.open("w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


# ---------------------------------------------------------------------------
# Stage helpers
# ---------------------------------------------------------------------------

def stage_key(stage: dict[str, Any]) -> str:
    world = stage.get("world_info_uid", 0)
    chapter = world - 100
    order = stage.get("stage_order", 0)
    return f"{chapter}-{order}"


def sort_key(s: str | dict[str, Any]) -> list[int]:
    code = s["code"] if isinstance(s, dict) else s
    return [int(p) for p in code.split("-")]


# ---------------------------------------------------------------------------
# Image download (imported from equip_image module above)
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Trickcal Stage Drop Updater")
    parser.add_argument("--dry-run", action="store_true", help="preview changes without writing")
    parser.add_argument("--skip-images", action="store_true", help="skip equip icon downloads")
    args = parser.parse_args()

    print("=== update_stages" + (" [DRY RUN]" if args.dry_run else "") + " ===\n")

    # ---- Fetch ----
    print(f"Fetching {STAGE_URL}...")
    html = fetch_page(STAGE_URL)
    if not html:
        print("ERROR: could not fetch stage page")
        sys.exit(1)
    print("  done")

    # ---- Extract stages ----
    print("Extracting stage data...")
    stages = extract_stages_from_html(html)
    if not stages:
        print("ERROR: no stages found. Check extraction logic.")
        sys.exit(1)
    print(f"  {len(stages)} stages total in payload")

    # ---- Filter difficulty=1, mode=1 ----
    filtered = [s for s in stages if s.get("difficulty") == 1 and s.get("mode") == 1]
    print(f"  {len(filtered)} stages with difficulty=1, mode=1")

    if not filtered:
        print("No matching stages found.")
        return

    # ---- Process drops → build equip map ----
    new_entries: dict[str, dict[str, Any]] = {}

    for stage in filtered:
        sk = stage_key(stage)
        drops = stage.get("drops")
        if not drops:
            continue
        for drop in drops:
            if not isinstance(drop, dict):
                continue
            inner_drops = drop.get("drops")
            if not inner_drops:
                continue
            for item in inner_drops:
                if not isinstance(item, dict):
                    continue
                equip = item.get("equip")
                if not equip or not isinstance(equip, dict):
                    continue
                name = equip.get("name")
                if not name:
                    continue
                rank = equip.get("grade", 1)
                icon = equip.get("icon", "")
                bg_rarity = equip.get("rarity", 1)
                drop_ratio = item.get("drop_ratio") or 0
                drop_rate = drop_ratio / 10000.0
                if name not in new_entries:
                    new_entries[name] = {"rank": rank, "bg_rarity": bg_rarity, "stages": {}, "icon": icon}
                new_entries[name]["stages"][sk] = {"code": sk, "dropRate": drop_rate}
                if not new_entries[name].get("icon"):
                    new_entries[name]["icon"] = icon

    print(f"  {len(new_entries)} unique equip(s) found in drops\n")

    if not new_entries:
        print("No equip drops found.")
        return

    # ---- Build gear + material uid lookup ----
    gear_name_to_uid: dict[str, int] = {}
    try:
        gear_db = load_json(GEAR_DATA_JSON)
        for uid_str, g in gear_db.items():
            name = g.get("name")
            if name:
                gear_name_to_uid[name] = g["uid"]
    except FileNotFoundError:
        print("  WARNING: gear/data.json not found")

    try:
        mat_db = load_json(MATERIAL_DATA_JSON)
        for uid_str, m in mat_db.items():
            name = m.get("name")
            if name:
                gear_name_to_uid[name] = m["uid"]
    except FileNotFoundError:
        print("  WARNING: gear/material.json not found")

    # ---- Merge with existing data ----
    sweep_data = load_json(SWEEP_JSON)
    existing_count = len(sweep_data)

    added_equips: list[str] = []
    updated_equips: list[tuple[str, list[str]]] = []
    rank_fixed_equips: list[tuple[str, Any, Any]] = []
    needs_migration = False

    for name, entry in sorted(new_entries.items()):
        new_stages_dict = entry["stages"]
        rank = entry["rank"]

        if name in sweep_data:
            old_rank = sweep_data[name].get("rank")
            if old_rank != rank:
                rank_fixed_equips.append((name, old_rank, rank))
                if not args.dry_run:
                    sweep_data[name]["rank"] = rank

            old_raw = sweep_data[name].get("stages", [])
            old_codes: set[str] = set()
            for s in old_raw:
                c = s["code"] if isinstance(s, dict) else s
                old_codes.add(c)
                if not isinstance(s, dict):
                    needs_migration = True

            new_codes = set(new_stages_dict.keys())
            added_codes = new_codes - old_codes

            if added_codes:
                updated_equips.append((name, sorted(added_codes, key=sort_key)))

            if not args.dry_run:
                merged: dict[str, dict[str, Any]] = {}
                for s in old_raw:
                    c = s["code"] if isinstance(s, dict) else s
                    merged[c] = s if isinstance(s, dict) else {"code": c, "dropRate": 0}
                merged.update(new_stages_dict)
                sweep_data[name]["stages"] = sorted(merged.values(), key=sort_key)
        else:
            added_equips.append(name)
            if not args.dry_run:
                new_entry: dict[str, Any] = {
                    "rank": rank,
                    "stages": sorted(new_stages_dict.values(), key=sort_key),
                }
                uid = gear_name_to_uid.get(name)
                if uid:
                    new_entry["uid"] = uid
                sweep_data[name] = new_entry

    # ---- Report ----
    if added_equips:
        print(f"New equip(s) ({len(added_equips)}):")
        for name in added_equips:
            r = new_entries[name]["rank"]
            stages = sorted(new_entries[name]["stages"].keys(), key=sort_key)
            print(f"  + {name!r} (rank={r}): {stages}")

    if rank_fixed_equips:
        print(f"\nRank fix(es) ({len(rank_fixed_equips)}):")
        for name, old_rank, new_rank in rank_fixed_equips:
            print(f"  ~ {name!r}: rank {old_rank} → {new_rank}")

    if updated_equips:
        print(f"\nUpdated stage(s) ({len(updated_equips)}):")
        for name, added in updated_equips:
            print(f"  ~ {name!r}: +{added}")

    if needs_migration:
        print(f"\nMigration: stages format → {{code, dropRate}}")

    had_changes = bool(added_equips or updated_equips or rank_fixed_equips or needs_migration)

    if not had_changes:
        print("Nothing new. Up to date.")

    # ---- Write ----
    if args.dry_run and had_changes:
        parts = []
        if added_equips:
            parts.append(f"add {len(added_equips)} new")
        if rank_fixed_equips:
            parts.append(f"fix rank for {len(rank_fixed_equips)}")
        if updated_equips:
            parts.append(f"update {len(updated_equips)} with new stages")
        if needs_migration:
            parts.append("migrate stages to dict format")
        print(f"\n[DRY RUN] Would {' + '.join(parts)}")

    # ---- Backfill uid for existing entries missing it ----
    uid_backfilled = 0
    for name, entry in sweep_data.items():
        if "uid" not in entry:
            uid = gear_name_to_uid.get(name)
            if uid:
                entry["uid"] = uid
                uid_backfilled += 1

    if uid_backfilled:
        had_changes = True
        print(f"\nUid backfill: {uid_backfilled} entries")

    if not args.dry_run and had_changes:
        save_json(SWEEP_JSON, sweep_data)
        total_after = len(sweep_data)
        print(f"\nSaved: {SWEEP_JSON.relative_to(PROJECT_ROOT)}")
        print(f"  {existing_count} → {total_after} equip(s) (+{total_after - existing_count})")

    # ---- Images ----
    print()
    if args.skip_images:
        print("--- Equip icons ---")
        print("  skipped (--skip-images)")
        return

    print("--- Equip icons ---")
    missing: list[tuple[str, str, int]] = []
    for name in sweep_data:
        dest = GEARS_DIR / f"{name}.webp"
        if not dest.exists():
            info = new_entries.get(name, {})
            icon = info.get("icon", "")
            bg_rarity = info.get("bg_rarity", 1)
            if icon:
                missing.append((name, icon, bg_rarity))
            else:
                print(f"  WARN: no icon data for {name!r}, skipping image")

    if not missing:
        print("  all equip icons present")
        return

    print(f"  {len(missing)} missing image(s):")
    for name, icon, bg_rarity in missing:
        download_equip_image(name, icon, bg_rarity, dry_run=args.dry_run)

    print()


if __name__ == "__main__":
    main()
