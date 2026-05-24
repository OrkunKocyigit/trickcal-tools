#!/usr/bin/env python3
"""
update_stages.py — Sync sweep stage drop data from soshage.com.

Fetches https://soshage.com/trickcal/zh-tw/stage, extracts SvelteKit SSR
stage data, finds equip drops for difficulty=1/mode=1 stages, and merges
new {chapter}-{stage_order} entries into public/sweep/data.json.
Also downloads missing equip icons to public/assets/gears/ with rarity
background compositing (same as update_foods.py).

Usage:
    python scripts/updater/update_stages.py [--dry-run] [--skip-images]
"""

import argparse
import io
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
    from PIL import Image  # type: ignore[import-untyped]
except ImportError:
    print(
        "ERROR: Missing deps. Run: .venv/Scripts/pip install -r requirements.txt",
        file=sys.stderr,
    )
    sys.exit(1)

SCRIPT_DIR = Path(__file__).parent.resolve()
PROJECT_ROOT = SCRIPT_DIR.parent.parent.resolve()
UPDATER_DIR = SCRIPT_DIR
SWEEP_JSON = PROJECT_ROOT / "public" / "sweep" / "data.json"
GEARS_DIR = PROJECT_ROOT / "public" / "assets" / "gears"
STAGE_URL = "https://soshage.com/trickcal/zh-tw/stage"
EQUIPICON_CDN = "https://img.kusoge.xyz/trickcal/equipicons/{icon}.webp"

_RARITY_BG: dict[int, str] = {1: "common", 2: "uncommon", 3: "rare", 4: "legendary"}

SESSION = requests.Session()
SESSION.headers.update({
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
})


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


def fetch_binary(url: str, retries: int = 2, delay: int = 2) -> bytes | None:
    for attempt in range(retries):
        try:
            resp = SESSION.get(url, timeout=30)
            resp.raise_for_status()
            return resp.content
        except Exception as exc:
            if attempt < retries - 1:
                print(f"    retry {attempt + 1}: {exc}")
            else:
                print(f"  WARNING: fetch failed: {url}: {exc}")
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


def sort_key(stage_str: str) -> list[int]:
    return [int(p) for p in stage_str.split("-")]


# ---------------------------------------------------------------------------
# Image download
# ---------------------------------------------------------------------------

def download_equip_image(name: str, icon: str, rank: int, dry_run: bool = False) -> bool:
    """Download equip icon, composite on rarity bg, save as webp."""
    dest = GEARS_DIR / f"{name}.webp"
    if dest.exists():
        return True

    url = EQUIPICON_CDN.format(icon=icon)

    if dry_run:
        print(f"  [DRY] would download {url} → {dest.name}")
        return True

    data = fetch_binary(url)
    if not data:
        print(f"  WARN: could not download image for {name!r} (icon={icon})")
        return False

    GEARS_DIR.mkdir(parents=True, exist_ok=True)

    bg_name = _RARITY_BG.get(rank)
    if bg_name is None:
        print(f"  WARN: no background for rarity {rank}, saving {name!r} raw")
        dest.write_bytes(data)
        print(f"  image saved (raw): {dest.name} ({len(data):,} bytes)")
        return True

    bg_path = UPDATER_DIR / f"{bg_name}.webp"
    if not bg_path.exists():
        print(f"  WARN: bg file not found {bg_path.name}, saving {name!r} raw")
        dest.write_bytes(data)
        print(f"  image saved (raw): {dest.name} ({len(data):,} bytes)")
        return True

    try:
        bg = Image.open(bg_path).convert("RGBA")
        canvas_w, canvas_h = bg.size

        canvas = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))

        inset = 5
        bg_small = bg.resize((canvas_w - inset * 2, canvas_h - inset * 2), Image.LANCZOS)
        canvas.paste(bg_small, (inset, inset), bg_small)

        icon_img = Image.open(io.BytesIO(data)).convert("RGBA")
        icon_w = icon_img.width * 9 // 10
        icon_h = icon_img.height * 9 // 10
        icon_small = icon_img.resize((icon_w, icon_h), Image.LANCZOS)
        x = (canvas_w - icon_w) // 2
        y = (canvas_h - icon_h) // 2
        canvas.paste(icon_small, (x, y), icon_small)

        canvas.save(dest, format="WEBP", lossless=True)
        print(f"  image saved: {dest.name} ({dest.stat().st_size:,} bytes)")
    except Exception as exc:
        print(f"  WARN: composite failed for {name!r}: {exc}, saving raw")
        dest.write_bytes(data)
        print(f"  image saved (raw): {dest.name} ({len(data):,} bytes)")

    return True


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
                if name not in new_entries:
                    new_entries[name] = {"rank": rank, "bg_rarity": bg_rarity, "stages": set(), "icon": icon}
                new_entries[name]["stages"].add(sk)
                if not new_entries[name].get("icon"):
                    new_entries[name]["icon"] = icon

    print(f"  {len(new_entries)} unique equip(s) found in drops\n")

    if not new_entries:
        print("No equip drops found.")
        return

    # ---- Merge with existing data ----
    sweep_data = load_json(SWEEP_JSON)
    existing_count = len(sweep_data)

    added_equips: list[str] = []
    updated_equips: list[tuple[str, list[str]]] = []
    rank_fixed_equips: list[tuple[str, Any, Any]] = []

    for name, entry in sorted(new_entries.items()):
        new_stages = entry["stages"]
        rank = entry["rank"]

        if name in sweep_data:
            old_rank = sweep_data[name].get("rank")
            if old_rank != rank:
                rank_fixed_equips.append((name, old_rank, rank))
                if not args.dry_run:
                    sweep_data[name]["rank"] = rank

            old_stages = set(sweep_data[name].get("stages", []))
            new = new_stages - old_stages
            if new:
                updated_equips.append((name, sorted(new, key=sort_key)))
                if not args.dry_run:
                    sweep_data[name]["stages"] = sorted(
                        old_stages | new_stages, key=sort_key
                    )
        else:
            added_equips.append(name)
            if not args.dry_run:
                sweep_data[name] = {
                    "rank": rank,
                    "stages": sorted(new_stages, key=sort_key),
                }

    # ---- Report ----
    if added_equips:
        print(f"New equip(s) ({len(added_equips)}):")
        for name in added_equips:
            r = new_entries[name]["rank"]
            stages = sorted(new_entries[name]["stages"], key=sort_key)
            print(f"  + {name!r} (rank={r}): {stages}")

    if rank_fixed_equips:
        print(f"\nRank fix(es) ({len(rank_fixed_equips)}):")
        for name, old_rank, new_rank in rank_fixed_equips:
            print(f"  ~ {name!r}: rank {old_rank} → {new_rank}")

    if updated_equips:
        print(f"\nUpdated stage(s) ({len(updated_equips)}):")
        for name, added in updated_equips:
            print(f"  ~ {name!r}: +{added}")

    had_changes = bool(added_equips or updated_equips or rank_fixed_equips)

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
        print(f"\n[DRY RUN] Would {' + '.join(parts)}")

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
