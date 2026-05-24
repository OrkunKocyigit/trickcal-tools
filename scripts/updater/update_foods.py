#!/usr/bin/env python3
"""
update_foods.py — Sync food catalogue and character food preferences from lsbim/foods.

Data source: https://github.com/lsbim/foods
  foodInfo-ko.js  — all food names with grades 0–5 (grade→rarity)
  charInfo.js     — per-character food preferences in Korean

Steps:
  1. Sparse-clone lsbim/foods to a temp directory
  2. Parse foodInfo-ko.js: every food name → grade → rarity
  3. Parse charInfo.js: every character → {en, verylike, like, hate}
  4. Update foods.json: add missing foods (KR canonical if no zh-TW name exists)
  5. Download missing food images (PNG→WebP) from raw.githubusercontent.com
  6. Update food/data.json: populate veryLike, like, dislike for all known characters
  7. Clean up temp directory

Run order: update_foods.py before update_units.py so new foods exist in
the catalogue when new characters are added.
"""

import argparse
import io
import json
import shutil
import sys
import tempfile
from pathlib import Path
from typing import Any

# Force UTF-8 output on Windows
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")  # type: ignore[union-attr]

try:
    import requests
    from PIL import Image  # type: ignore[import-untyped]
except ImportError:
    print(
        "ERROR: Missing deps. Run: .venv/Scripts/pip install -r requirements.txt",
        file=sys.stderr,
    )
    sys.exit(1)

from lsbim_foods import (
    CN_TO_KR,
    _rmtree,
    build_en_to_cn,
    build_en_to_food,
    clone_lsbim_foods,
    food_rarity,
    get_food_image_url,
    grade_to_rarity,
    load_char_food_info,
    load_food_grades,
    translate_food,
    translate_foods,
)

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
PROJECT_ROOT    = Path(__file__).resolve().parent.parent.parent
CHARACTERS_JSON = PROJECT_ROOT / "public" / "shared" / "characters.json"
FOOD_JSON       = PROJECT_ROOT / "public" / "food"   / "data.json"
FOODS_CAT_JSON  = PROJECT_ROOT / "public" / "food"   / "foods.json"
FOOD_IMAGES_DIR = PROJECT_ROOT / "public" / "assets" / "foods"
UPDATER_DIR     = Path(__file__).resolve().parent   # background .webp files live here

# Rarity sort order for foods.json (lowest → highest)
_RARITY_ORDER = {"common": 0, "uncommon": 1, "rare": 2, "legendary": 3}

# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------
_SESSION = requests.Session()
_SESSION.headers["User-Agent"] = "Mozilla/5.0 (compatible; trickcal-updater/1.0)"


def fetch(url: str) -> "requests.Response | None":
    try:
        r = _SESSION.get(url, timeout=30)
        r.raise_for_status()
        return r
    except Exception as exc:
        print(f"  WARN: fetch failed — {url}: {exc}")
        return None


# ---------------------------------------------------------------------------
# JSON helpers
# ---------------------------------------------------------------------------

def load_json(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def save_json(path: Path, data: dict[str, Any]) -> None:
    with path.open("w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"  saved: {path.relative_to(PROJECT_ROOT)} ({path.stat().st_size:,} bytes)")


# ---------------------------------------------------------------------------
# Image download
# ---------------------------------------------------------------------------

def download_food_image(canonical: str, rarity: str, dry_run: bool = False) -> bool:
    """
    Download food icon from lsbim/foods CDN, composite it at 50% size centred on the
    rarity background image (common/uncommon/rare/legendary.webp in UPDATER_DIR).
    Returns True on success or if the file already exists.
    """
    dest = FOOD_IMAGES_DIR / f"{canonical}.webp"
    if dest.exists():
        return True

    # Resolve KR name: CN-canonical foods need reverse lookup; KR-canonical use as-is
    kr_name = CN_TO_KR.get(canonical, canonical)
    url = get_food_image_url(kr_name)

    if dry_run:
        print(f"  [DRY] would download: {url!r} → {dest.name}")
        return True

    resp = fetch(url)
    if not resp:
        print(f"  WARN: could not download image for {canonical!r} (kr={kr_name!r})")
        return False

    try:
        # Load background for this rarity
        bg_path = UPDATER_DIR / f"{rarity}.webp"
        if not bg_path.exists():
            bg_path = UPDATER_DIR / "common.webp"
        bg = Image.open(bg_path).convert("RGBA")
        canvas_w, canvas_h = bg.size

        # Load icon, resize to 50%
        icon = Image.open(io.BytesIO(resp.content)).convert("RGBA")
        icon_w = icon.width  // 2
        icon_h = icon.height // 2
        icon_small = icon.resize((icon_w, icon_h), Image.LANCZOS)

        # Composite: icon centred over background
        result = bg.copy()
        x = (canvas_w - icon_w) // 2
        y = (canvas_h - icon_h) // 2
        result.paste(icon_small, (x, y), icon_small)

        FOOD_IMAGES_DIR.mkdir(parents=True, exist_ok=True)
        result.save(dest, format="WEBP", lossless=True)
        print(f"  image saved: {dest.name} ({dest.stat().st_size:,} bytes)")
    except Exception as exc:
        print(f"  WARN: image convert failed for {canonical!r}: {exc}")
        return False
    return True


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--dry-run",     action="store_true",
                        help="Preview changes without writing files.")
    parser.add_argument("--skip-images", action="store_true",
                        help="Skip image downloads.")
    args = parser.parse_args()

    print("=== update_foods" + (" [DRY RUN]" if args.dry_run else "") + " ===\n")

    tmp = Path(tempfile.gettempdir()) / "trickcal_lsbim_foods"

    # ---- Clone lsbim/foods ----
    print("Cloning lsbim/foods (sparse)...")
    try:
        clone_lsbim_foods(tmp)
        print("  done")
    except Exception as exc:
        print(f"ERROR: clone failed: {exc}", file=sys.stderr)
        sys.exit(1)

    try:
        _run(args, tmp)
    finally:
        if tmp.exists():
            _rmtree(tmp)
        print("\n  cleaned up temp dir")


def _run(args: argparse.Namespace, repo: Path) -> None:
    # ---- Parse remote data ----
    print("\nParsing lsbim/foods data...")
    kr_to_grade    = load_food_grades(repo)
    char_food_info = load_char_food_info(repo)
    print(f"  {len(kr_to_grade)} foods in foodInfo-ko.js  |  "
          f"{len(char_food_info)} chars in charInfo.js")

    # ---- Load local data ----
    print("\nLoading local data...")
    characters = load_json(CHARACTERS_JSON)
    food_data  = load_json(FOOD_JSON)
    foods_cat  = load_json(FOODS_CAT_JSON)
    print(f"  {len(characters)} characters  |  "
          f"{len(foods_cat)} catalogue foods  |  "
          f"{len(food_data)} chars with food prefs")

    en_to_cn   = build_en_to_cn(characters)
    en_to_food = build_en_to_food(char_food_info)

    # ---- Step 1: Update foods catalogue (foods.json) ----
    print("\n--- Foods catalogue (foods.json) ---")

    # Task 4: build the set of food names actually referenced by any character
    referenced_foods: set[str] = set()
    for info in char_food_info.values():
        food_prefs = info["food"]
        for bucket in ("verylike", "like", "hate"):   # soso excluded per spec
            for kr in food_prefs.get(bucket, []):
                referenced_foods.add(translate_food(kr))   # canonical name

    new_cat: dict[str, Any] = {}
    for kr, grade in kr_to_grade.items():
        canonical = translate_food(kr)          # CN if known, else KR
        if canonical not in foods_cat and canonical not in new_cat:
            # Task 4: skip foods no character cares about
            if canonical not in referenced_foods:
                continue
            # Task 5: use per-food rarity override if available
            new_cat[canonical] = {"rarity": food_rarity(kr, grade)}

    if new_cat:
        for name, entry in new_cat.items():
            print(f"  + {name!r}  rarity={entry['rarity']}")
        if not args.dry_run:
            merged = {**foods_cat, **new_cat}
            # Task 2: sort by rarity (common→uncommon→rare→legendary)
            sorted_cat = dict(
                sorted(merged.items(),
                       key=lambda kv: _RARITY_ORDER.get(kv[1].get("rarity", "common"), 0))
            )
            save_json(FOODS_CAT_JSON, sorted_cat)
            foods_cat = sorted_cat
    else:
        print("  catalogue up to date")

    # Working catalogue includes newly added entries even in dry-run
    working_cat = {**foods_cat, **new_cat}

    # ---- Step 2: Food images ----
    print("\n--- Food images ---")
    if args.skip_images:
        print("  skipped (--skip-images)")
    else:
        missing = [
            c for c in working_cat
            if not (FOOD_IMAGES_DIR / f"{c}.webp").exists()
        ]
        if missing:
            print(f"  {len(missing)} missing image(s):")
            for canonical in missing:
                rarity = working_cat[canonical].get("rarity", "common")
                download_food_image(canonical, rarity, dry_run=args.dry_run)
        else:
            print("  all food images present")

    # ---- Step 3: Character food preferences (food/data.json) ----
    print("\n--- Character food preferences (food/data.json) ---")
    updated = {k: {**v} for k, v in food_data.items()}
    changes: list[str] = []

    for kr_char, info in char_food_info.items():
        en_lower = info["en"].lower()
        cn_name  = en_to_cn.get(en_lower)
        if cn_name is None:
            continue   # variant, unknown, or not in characters.json

        food  = info["food"]
        v_like   = translate_foods(food["verylike"])
        like     = translate_foods(food["like"])
        dislike  = translate_foods(food["hate"])

        existing = updated.get(cn_name, {"veryLike": [], "like": [], "dislike": []})
        seen: set[str] = set(
            existing.get("veryLike", [])
            + existing.get("like",    [])
            + existing.get("dislike", [])
        )

        new_vl = list(existing.get("veryLike", []))
        new_lk = list(existing.get("like",    []))
        new_dl = list(existing.get("dislike", []))
        changed = False

        for name in v_like:
            if name not in seen:
                new_vl.append(name); seen.add(name); changed = True
                changes.append(f"  {cn_name}: veryLike += {name!r}")
        for name in like:
            if name not in seen:
                new_lk.append(name); seen.add(name); changed = True
                changes.append(f"  {cn_name}: like += {name!r}")
        for name in dislike:
            if name not in seen:
                new_dl.append(name); seen.add(name); changed = True
                changes.append(f"  {cn_name}: dislike += {name!r}")

        if changed:
            updated[cn_name] = {
                "veryLike": new_vl,
                "like":     new_lk,
                "dislike":  new_dl,
            }

    if changes:
        print(f"  {len(changes)} change(s):")
        for line in changes:
            print(line)
        if not args.dry_run:
            save_json(FOOD_JSON, updated)
    else:
        print("  food preferences up to date")

    print("\nDone.")


if __name__ == "__main__":
    main()
