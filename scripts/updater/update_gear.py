#!/usr/bin/env python3
"""
Auto Gear Updater — scrapes equipment data for all units from soshage.com.

Determines max rank per unit, builds gear ID arrays per rank per character,
and maintains a master gear database (gear/data.json) with uid + names.

Usage:
    python update_gear.py [--dry-run]
"""

import argparse
import io
import json
import random
import re
import sys
import time
from pathlib import Path
from typing import Any

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

try:
    import requests
    from PIL import Image  # type: ignore[import-untyped]
except ImportError:
    print("ERROR: Missing deps. Run: .venv/Scripts/pip install -r requirements.txt", file=sys.stderr)
    sys.exit(1)

from equip_image import download_equip_image, GEARS_DIR  # noqa: E402

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
SCRIPT_DIR = Path(__file__).parent.resolve()
PROJECT_ROOT = SCRIPT_DIR.parent.parent.resolve()

CHARACTERS_JSON = PROJECT_ROOT / "public" / "shared" / "characters.json"
GEAR_DIR = PROJECT_ROOT / "public" / "gear"
GEAR_DATA_JSON = GEAR_DIR / "data.json"
MATERIAL_DATA_JSON = GEAR_DIR / "material.json"

# ---------------------------------------------------------------------------
# URLs
# ---------------------------------------------------------------------------
SOSHAGE_BASE = "https://soshage.com/trickcal/en"
SOSHAGE_ZH_TW = "https://soshage.com/trickcal/zh-tw"

# ---------------------------------------------------------------------------
# Slot index → type label
# ---------------------------------------------------------------------------
SLOT_TYPES = ["body", "weapon", "hat", "boots", "ring", "accessory"]

# ---------------------------------------------------------------------------
# HTTP session
# ---------------------------------------------------------------------------
SESSION = requests.Session()
SESSION.headers.update({
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/126.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
    "Accept-Encoding": "gzip, deflate",
    "Connection": "keep-alive",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
})


def fetch(url: str, retries: int = 2, delay: int = 2) -> "requests.Response | None":
    """GET with retry. Returns Response or None on failure."""
    for attempt in range(retries):
        try:
            resp = SESSION.get(url, timeout=20)
            resp.raise_for_status()
            return resp
        except Exception as exc:
            if attempt < retries - 1:
                print(f"    retry {attempt + 1} for {url}: {exc}")
                time.sleep(delay)
            else:
                print(f"  WARNING: failed to fetch {url}: {exc}")
    return None


# ---------------------------------------------------------------------------
# JS → JSON converter (SvelteKit SSR embeds JS object literals, not JSON)
# ---------------------------------------------------------------------------

def _match_bracket(text: str, start: int, open_ch: str, close_ch: str) -> int:
    """Return index of matching closing bracket. Returns -1 if not found."""
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
    """
    Convert a JavaScript object/array literal to valid JSON.
    Handles:
      - unquoted object keys  (key: -> "key":)
      - JS bare decimal floats (.02 -> 0.02)
      - trailing commas       (,} / ,] -> } / ])
    """
    out = io.StringIO()
    i = 0
    n = len(js)
    while i < n:
        c = js[i]
        if c == '"':
            out.write(c)
            i += 1
            while i < n:
                sc = js[i]
                out.write(sc)
                if sc == "\\":
                    i += 1
                    if i < n:
                        out.write(js[i])
                elif sc == '"':
                    i += 1
                    break
                i += 1
            continue
        if c in "{,":
            out.write(c)
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
                    out.write(ws + '"' + key + '"')
                else:
                    out.write(ws + key)
            else:
                out.write(ws)
            continue
        out.write(c)
        i += 1

    result = out.getvalue()
    result = re.sub(
        r"([:,\[{])\s*(-?)\.(\d)",
        lambda m: m.group(1) + m.group(2) + "0." + m.group(3),
        result,
    )
    result = re.sub(r",(\s*[}\]])", r"\1", result)
    return result


# ---------------------------------------------------------------------------
# Equipment extraction from page HTML
# ---------------------------------------------------------------------------

def extract_equips_from_en_html(html: str, unit_uid: int) -> list[dict[str, Any]]:
    """Extract the equips[] array from an EN unit page's SSR payload."""
    return _extract_equips(html, unit_uid)


def extract_equips_from_zh_html(html: str, unit_uid: int) -> list[dict[str, Any]]:
    """Extract the equips[] array from a ZH-TW unit page's SSR payload."""
    return _extract_equips(html, unit_uid)


def _extract_equips(html: str, unit_uid: int) -> list[dict[str, Any]]:
    """
    Find the outer equips[] array in a unit page's SSR payload
    by matching the unit_uid, then parse from the opening '['.
    """
    pattern = f',equips:[{{unit_uid:{unit_uid}'
    idx = html.find(pattern)
    if idx == -1:
        return []

    bracket_start = html.index("[", idx)
    bracket_end = _match_bracket(html, bracket_start, "[", "]")
    if bracket_end == -1:
        return []

    equips_js = html[bracket_start : bracket_end + 1]
    equips_json = _js_to_json(equips_js)

    try:
        result = json.loads(equips_json)
        if isinstance(result, list):
            return result  # type: ignore[return-value]
    except json.JSONDecodeError as exc:
        pos = exc.pos or 0
        ctx = equips_json[max(0, pos - 60) : pos + 60]
        print(f"  WARNING: failed to parse equips JSON at pos {pos}: {exc.msg}")
        print(f"  Context: ...{ctx!r}...")
    return []


# ---------------------------------------------------------------------------
# Gear parsing helpers
# ---------------------------------------------------------------------------

def parse_gear_from_equips(equips_data: list[dict[str, Any]]) -> tuple[int, list[list[int]], dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    """
    Parse equips data to extract max rank, gear-per-rank, and gear objects.

    Returns (max_rank, gear_by_rank, gear_objects, material_objects).
      - max_rank: number of ranks with 6 equipment slots
      - gear_by_rank: list of [6 int uids] per rank
      - gear_objects: dict keyed by str(uid) with {uid, nameEn, type, recipe}
      - material_objects: dict keyed by str(uid) with {uid, nameEn}
    """
    max_rank = 0
    gear_by_rank: list[list[int]] = []
    gear_objects: dict[str, dict[str, Any]] = {}
    material_objects: dict[str, dict[str, Any]] = {}

    for rank_entry in equips_data:
        rank = rank_entry.get("rank", 0)
        inner_equips = rank_entry.get("equips")
        if not isinstance(inner_equips, list) or len(inner_equips) == 0:
            continue

        # Only count ranks with 6 equipment slots
        if len(inner_equips) != 6:
            continue

        # Use equip_list for uid order
        equip_list_str = rank_entry.get("equip_list", "")
        if equip_list_str:
            gear_uids = [int(x) for x in equip_list_str.split(",") if x]
            if len(gear_uids) == 6:
                gear_by_rank.append(gear_uids)
                max_rank = max(max_rank, rank)
            else:
                continue
        else:
            continue

        # Extract gear object data (English names + recipe)
        for slot_idx, gear_obj in enumerate(inner_equips):
            uid = gear_obj.get("uid")
            if not uid:
                continue
            uid_str = str(uid)
            if uid_str not in gear_objects:
                entry: dict[str, Any] = {
                    "uid": uid,
                    "nameEn": gear_obj.get("name", ""),
                    "type": SLOT_TYPES[slot_idx] if slot_idx < len(SLOT_TYPES) else "unknown",
                    "icon": gear_obj.get("icon", ""),
                }
                raw_rarity = gear_obj.get("rarity")
                if raw_rarity is not None:
                    entry["rarity"] = raw_rarity

                # Parse recipe
                recipe_data = gear_obj.get("recipe")
                recipe_list: list[dict[str, int]] = []
                if recipe_data and isinstance(recipe_data, dict):
                    req_item_str = recipe_data.get("req_item", "")
                    req_count_str = recipe_data.get("req_count", "")
                    if req_item_str and req_count_str:
                        req_items = [int(x) for x in req_item_str.split(",") if x]
                        req_counts = [int(x) for x in req_count_str.split(",") if x]
                        for mat_uid, mat_count in zip(req_items, req_counts):
                            if mat_uid and mat_count:
                                recipe_list.append({"uid": mat_uid, "count": mat_count})

                    # Extract material objects from recipe.req[]
                    req_array = recipe_data.get("req")
                    if req_array and isinstance(req_array, list):
                        for mat_obj in req_array:
                            if not isinstance(mat_obj, dict):
                                continue
                            mat_uid = mat_obj.get("uid")
                            if not mat_uid:
                                continue
                            mat_uid_str = str(mat_uid)
                            if mat_uid_str not in material_objects:
                                material_objects[mat_uid_str] = {
                                    "uid": mat_uid,
                                    "nameEn": mat_obj.get("name", ""),
                                }

                if recipe_list:
                    entry["recipe"] = recipe_list
                gear_objects[uid_str] = entry

    return max_rank, gear_by_rank, gear_objects, material_objects


# ---------------------------------------------------------------------------
# JSON I/O
# ---------------------------------------------------------------------------

def load_json(path: Path) -> dict[str, Any]:
    if path.exists():
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_json(path: Path, data: dict[str, Any], dry_run: bool = False) -> None:
    content = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    if dry_run:
        print(f"  [DRY RUN] would write {path.relative_to(PROJECT_ROOT)} ({len(content)} bytes)")
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(content)
    print(f"  wrote {path.relative_to(PROJECT_ROOT)}")


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Trickcal Gear Updater")
    parser.add_argument("--dry-run", action="store_true", help="show changes without writing files")
    parser.add_argument("--skip-images", action="store_true", help="skip equip icon downloads")
    args = parser.parse_args()

    print("=== Trickcal Gear Updater ===")
    if args.dry_run:
        print("[DRY RUN - no files will be modified]\n")

    # ---- Load existing data ----
    print("Loading existing data...")
    characters: dict[str, Any] = load_json(CHARACTERS_JSON)
    gear_db: dict[str, Any] = load_json(GEAR_DATA_JSON)
    material_db: dict[str, Any] = load_json(MATERIAL_DATA_JSON)
    print(f"  {len(characters)} characters  |  {len(gear_db)} gear items  |  {len(material_db)} materials in DB")

    # One-time: force re-scrape to populate icon+rarity from source
    needs_reprocess = any(not entry.get("icon") for entry in gear_db.values())
    if needs_reprocess:
        print("  Some gear entries missing icon — re-scraping all characters to populate")
        for c in characters.values():
            if isinstance(c, dict):
                c.pop("maxRank", None)
                c.pop("gear", None)

    missing_cn_material: set[str] = set()

    # ---- Determine max rank from first unit ----
    first_uid = None
    for cn_name, char_data in characters.items():
        if isinstance(char_data, dict) and char_data.get("id"):
            first_uid = char_data["id"]
            break

    if not first_uid:
        print("ERROR: no characters with valid uid found.")
        sys.exit(1)

    print(f"\nDetermining max rank from unit {first_uid}...")
    initial_delay = random.uniform(1.0, 2.5)
    print(f"  initial delay {initial_delay:.1f}s...")
    time.sleep(initial_delay)

    resp = fetch(f"{SOSHAGE_BASE}/unit/{first_uid}")
    if not resp:
        print("ERROR: could not fetch first unit page.")
        sys.exit(1)
    resp.encoding = "utf-8"
    equips_data = extract_equips_from_en_html(resp.text, first_uid)
    if not equips_data:
        print("ERROR: could not extract equips data from first unit page.")
        sys.exit(1)

    max_rank, _, _, _ = parse_gear_from_equips(equips_data)
    if not max_rank:
        print("ERROR: could not determine max rank.")
        sys.exit(1)
    print(f"  max rank = {max_rank}")

    # ---- Process each character ----
    total_new_gear = 0
    total_new_material = 0
    chars_updated = 0
    consecutive_errors = 0
    MAX_ERRORS = 5

    # Collect uids that still need Chinese name backfill
    missing_cn: set[str] = set()

    # Strip gear fields so every character is re-processed when building fresh
    if not gear_db and not material_db:
        for c in characters.values():
            if isinstance(c, dict):
                c.pop("maxRank", None)
                c.pop("gear", None)

    # Flag: first-time material extraction — process all chars regardless of existing data
    extract_materials = not material_db

    for cn_name, char_data in characters.items():
        if not isinstance(char_data, dict):
            continue

        unit_uid = char_data.get("id")
        if not unit_uid:
            continue

        # Skip if already fully processed (unless extracting materials for first time)
        if not extract_materials and char_data.get("maxRank") is not None and char_data.get("gear") is not None:
            continue

        print(f"\n  [{cn_name}] uid={unit_uid}")

        time.sleep(random.uniform(0.3, 0.6))

        resp = fetch(f"{SOSHAGE_BASE}/unit/{unit_uid}")
        if not resp:
            consecutive_errors += 1
            if consecutive_errors >= MAX_ERRORS:
                print(f"    Stopping: {MAX_ERRORS} consecutive errors")
                break
            continue

        consecutive_errors = 0
        resp.encoding = "utf-8"
        equips_data = extract_equips_from_en_html(resp.text, unit_uid)
        if not equips_data:
            print(f"    WARNING: no equips data, skipping")
            continue

        rank_count, gear_by_rank, en_gear_objects, en_material_objects = parse_gear_from_equips(equips_data)
        if rank_count < max_rank:
            print(f"    WARNING: found {rank_count} ranks, expected {max_rank}")
            continue

        # Build character gear array
        gear_rank_array: list[list[int]] = []
        for rank_idx in range(max_rank):
            if rank_idx < len(gear_by_rank):
                gear_rank_array.append(gear_by_rank[rank_idx])
            else:
                print(f"    WARNING: missing rank {rank_idx + 1} data")
                break
        else:
            # All ranks present - set in memory regardless of dry-run
            char_data["maxRank"] = max_rank
            char_data["gear"] = gear_rank_array

            # Merge gear objects into DB
            for uid_str, gear_obj in en_gear_objects.items():
                if uid_str not in gear_db:
                    entry: dict[str, Any] = {
                        "uid": gear_obj["uid"],
                        "name": "",
                        "nameEn": gear_obj["nameEn"],
                        "type": gear_obj["type"],
                        "icon": gear_obj.get("icon", ""),
                    }
                    raw_rarity = gear_obj.get("rarity")
                    if raw_rarity is not None:
                        entry["rarity"] = raw_rarity
                    recipe = gear_obj.get("recipe")
                    if recipe:
                        entry["recipe"] = recipe
                    gear_db[uid_str] = entry
                    total_new_gear += 1
                else:
                    existing = gear_db[uid_str]
                    recipe = gear_obj.get("recipe")
                    if recipe and "recipe" not in existing:
                        existing["recipe"] = recipe
                    if not existing.get("icon"):
                        existing["icon"] = gear_obj.get("icon", "")
                    if "rarity" not in existing:
                        raw_rarity = gear_obj.get("rarity")
                        if raw_rarity is not None:
                            existing["rarity"] = raw_rarity

                if not gear_db[uid_str].get("name"):
                    missing_cn.add(uid_str)

            # Merge material objects into DB
            for uid_str, mat_obj in en_material_objects.items():
                if uid_str not in material_db:
                    material_db[uid_str] = {
                        "uid": mat_obj["uid"],
                        "name": "",
                        "nameEn": mat_obj["nameEn"],
                    }
                    total_new_material += 1

                if not material_db[uid_str].get("name"):
                    missing_cn_material.add(uid_str)

            chars_updated += 1
            print(f"    ok ({len(gear_rank_array)} ranks)")

    # ---- Backfill Chinese names ----
    if missing_cn or missing_cn_material:
        total_missing = len(missing_cn) + len(missing_cn_material)
        print(f"\n--- Backfilling Chinese names for {total_missing} items ---")
        if missing_cn:
            print(f"  {len(missing_cn)} gear items")
        if missing_cn_material:
            print(f"  {len(missing_cn_material)} material items")

        # Find a character whose gear includes missing-CN items
        for cn_name, char_data in characters.items():
            if not isinstance(char_data, dict):
                continue
            gear = char_data.get("gear")
            if not gear:
                continue
            unit_uid = char_data.get("id")
            if not unit_uid:
                continue

            needed = missing_cn | missing_cn_material
            if not needed:
                break

            # Check if this character has any missing-CN gear or materials
            gear_uids = {str(uid) for rank in gear for uid in rank}
            needs_fetch = gear_uids & needed
            if not needs_fetch:
                continue

            print(f"\n  Fetching zh-tw for {cn_name} (uid={unit_uid})...")
            time.sleep(random.uniform(0.3, 0.6))

            resp = fetch(f"{SOSHAGE_ZH_TW}/unit/{unit_uid}")
            if not resp:
                print(f"    WARNING: could not fetch zh-tw page")
                continue

            resp.encoding = "utf-8"
            equips_data = extract_equips_from_zh_html(resp.text, unit_uid)
            if not equips_data:
                print(f"    WARNING: no equips in zh-tw page")
                continue

            found_any = False
            for rank_entry in equips_data:
                inner_equips = rank_entry.get("equips")
                if not isinstance(inner_equips, list):
                    continue
                for gear_obj in inner_equips:
                    uid = gear_obj.get("uid")
                    if not uid:
                        continue
                    uid_str = str(uid)
                    # Backfill gear Chinese name
                    if uid_str in missing_cn:
                        cn_name_gear = gear_obj.get("name", "")
                        if cn_name_gear and cn_name_gear != gear_db[uid_str].get("nameEn"):
                            gear_db[uid_str]["name"] = cn_name_gear
                            missing_cn.discard(uid_str)
                            found_any = True
                            print(f"    uid {uid_str}: '{cn_name_gear}'")

                    # Backfill material Chinese names from recipe.req[]
                    recipe_data = gear_obj.get("recipe")
                    if recipe_data and isinstance(recipe_data, dict):
                        req_array = recipe_data.get("req")
                        if req_array and isinstance(req_array, list):
                            for mat_obj in req_array:
                                if not isinstance(mat_obj, dict):
                                    continue
                                mat_uid = mat_obj.get("uid")
                                if not mat_uid:
                                    continue
                                mat_uid_str = str(mat_uid)
                                if mat_uid_str in missing_cn_material:
                                    cn_name_mat = mat_obj.get("name", "")
                                    if cn_name_mat:
                                        material_db[mat_uid_str]["name"] = cn_name_mat
                                        missing_cn_material.discard(mat_uid_str)
                                        found_any = True
                                        print(f"    material uid {mat_uid_str}: '{cn_name_mat}'")

            if not missing_cn and not missing_cn_material:
                print("  All Chinese names found!")
                break

    # ---- Summary ----
    print(f"\n=== Summary ===")
    print(f"  Characters updated: {chars_updated}")
    print(f"  New gear items: {total_new_gear}")
    print(f"  New material items: {total_new_material}")
    if missing_cn:
        print(f"  Gear missing Chinese names: {len(missing_cn)}")
    if missing_cn_material:
        print(f"  Material missing Chinese names: {len(missing_cn_material)}")

    if args.dry_run:
        print("\n[DRY RUN] skipping file writes.")
        return

    # ---- Save ----
    print("\nWriting files...")
    save_json(CHARACTERS_JSON, characters)
    save_json(GEAR_DATA_JSON, gear_db)
    save_json(MATERIAL_DATA_JSON, material_db)

    # ---- Images ----
    print()
    if args.skip_images:
        print("--- Equip icons ---")
        print("  skipped (--skip-images)")
        print("\nDone.")
        return

    print("--- Equip icons ---")
    missing_images: list[tuple[str, str, int]] = []
    for uid_str, entry in gear_db.items():
        name = entry.get("name", "")
        icon = entry.get("icon", "")
        rarity = entry.get("rarity", 1)
        if not name or not icon:
            continue
        dest = GEARS_DIR / f"{name}.webp"
        if not dest.exists():
            missing_images.append((name, icon, rarity))

    if not missing_images:
        print("  all gear icons present")
    else:
        print(f"  {len(missing_images)} missing gear image(s):")
        for name, icon, rarity in missing_images:
            download_equip_image(name, icon, rarity, dry_run=args.dry_run)

    print("\nDone.")


if __name__ == "__main__":
    main()
