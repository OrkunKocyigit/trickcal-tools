#!/usr/bin/env python3
"""
Auto Unit Updater — scrapes new character data from external wikis
and appends to local JSON data files.

Usage:
    python update_units.py [--dry-run] [--skip-images]

Note: Unit names are fetched from the English version of soshage.com.
  The `en` field is populated automatically. The `name` (Chinese) field
  defaults to the English name as a placeholder — update manually before
  committing if you need the correct Traditional Chinese name.
"""

import argparse
import io
import json
import re
import shutil
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

# Force UTF-8 output on Windows (avoids cp1252 errors with Chinese characters)
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")  # type: ignore[union-attr]

try:
    import requests
    from bs4 import BeautifulSoup, Tag
    from PIL import Image  # type: ignore[import-untyped]
except ImportError:
    print("ERROR: Missing deps. Run: .venv/Scripts/pip install -r requirements.txt", file=sys.stderr)
    sys.exit(1)

from lsbim_foods import (
    CN_TO_KR,
    _rmtree,
    build_en_to_cn,
    build_en_to_food,
    clone_lsbim_foods,
    food_rarity,
    get_food_image_url,
    get_food_prefs,
    grade_to_rarity,
    load_char_food_info,
    load_food_grades,
    translate_food,
)

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
SCRIPT_DIR = Path(__file__).parent.resolve()
PROJECT_ROOT = SCRIPT_DIR.parent.parent.resolve()

CHARACTERS_JSON = PROJECT_ROOT / "public" / "shared" / "characters.json"
BOARD_JSON = PROJECT_ROOT / "public" / "board" / "data.json"
FOOD_JSON = PROJECT_ROOT / "public" / "food" / "data.json"
FOODS_CATALOGUE_JSON = PROJECT_ROOT / "public" / "food" / "foods.json"
PORTRAITS_DIR = PROJECT_ROOT / "public" / "assets" / "characters"
FOOD_IMAGES_DIR = PROJECT_ROOT / "public" / "assets" / "foods"

# ---------------------------------------------------------------------------
# URLs
# ---------------------------------------------------------------------------
SOSHAGE_BASE = "https://soshage.com/trickcal/en"
SOSHAGE_ZH_TW = "https://soshage.com/trickcal/zh-tw"
HEROICON_CDN = "https://img.kusoge.xyz/trickcal/heroicons/{icon}.webp"

# ---------------------------------------------------------------------------
# Field mappings — verified against live soshage.com data
# (PLAN.md had some incorrect tribe/section values; these are correct)
# ---------------------------------------------------------------------------
ATTACK_TYPE_MAP: dict[int, str] = {1: "物理", 2: "魔法"}
DEPLOY_ROW_MAP: dict[int, str] = {1: "前排", 2: "中排", 3: "後排", 4: "後排"}
ROLE_MAP: dict[int, str] = {1: "坦克", 2: "輸出", 3: "輔助"}
PERSONALITY_MAP: dict[int, str] = {0: "天真", 1: "冷靜", 2: "狂亂", 3: "活潑", 4: "憂鬱"}
RACE_MAP: dict[int, str] = {
    0: "妖精", 1: "獸人", 2: "精靈", 3: "魔靈",
    4: "幽靈", 5: "龍族", 6: "魔女", 7: "???",
}

# ---------------------------------------------------------------------------
# HTTP session
# ---------------------------------------------------------------------------
SESSION = requests.Session()
SESSION.headers.update({
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
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
      - unquoted object keys  (key: → "key":)
      - JS bare decimal floats (.02 → 0.02)
      - trailing commas       (,} / ,] → } / ])
    Does NOT handle: single-quoted strings, template literals,
    JS expressions (new URL(...), etc.) — avoid feeding those in.
    """
    out = io.StringIO()
    i = 0
    n = len(js)
    while i < n:
        c = js[i]
        # --- String literal: copy verbatim ---
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
        # --- After { or , : check for unquoted identifier key ---
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
    # Fix bare decimal floats:  :-.02  →  :-0.02   :.02  →  :0.02
    result = re.sub(
        r"([:,\[{])\s*(-?)\.(\d)",
        lambda m: m.group(1) + m.group(2) + "0." + m.group(3),
        result,
    )
    # Remove trailing commas before } or ]
    result = re.sub(r",(\s*[}\]])", r"\1", result)
    return result


def extract_news_from_html(html: str) -> list[dict[str, Any]]:
    """
    Find the 'news' array embedded in the SvelteKit SSR payload.
    The payload uses JS object notation (unquoted keys), which we convert to JSON.
    """
    m = re.search(r'"?news"?\s*:\s*\[', html)
    if not m:
        return []
    bracket_start = html.index("[", m.start())
    bracket_end = _match_bracket(html, bracket_start, "[", "]")
    if bracket_end == -1:
        return []

    news_js = html[bracket_start : bracket_end + 1]
    news_json_str = _js_to_json(news_js)
    try:
        result = json.loads(news_json_str)
        if isinstance(result, list):
            return result  # type: ignore[return-value]
    except json.JSONDecodeError as exc:
        pos = exc.pos or 0
        ctx = news_json_str[max(0, pos - 60) : pos + 60]
        print(f"  WARNING: failed to parse news JSON at pos {pos}: {exc.msg}")
        print(f"  Context: ...{ctx!r}...")
    return []


def get_news_entries() -> list[dict[str, Any]]:
    """Fetch soshage homepage and extract the news[] array."""
    print("  fetching soshage.com...")
    resp = fetch(SOSHAGE_BASE)
    if not resp:
        return []
    news = extract_news_from_html(resp.text)
    if not news:
        print("  WARNING: news[] not found in soshage HTML")
    return news


# ---------------------------------------------------------------------------
# Board scraping
# ---------------------------------------------------------------------------

def parse_board_stat(text: str) -> str | None:
    """
    Map board button text to stat key.
    Examples:
      "All Magical ATK: 3% All Physical ATK: 3%"  → "attack"
      "All Magical DEF: 4% All Physical DEF: 4%"  → "defense"
      "All HP: 4%"                                 → "hp"
      "All CRIT Resistance: 5% All CRIT DMG RES: 5%" → "critResist"
      "All CRIT Hit: 5% All CRIT DMG: 5%"         → "crit"
    """
    t = text.upper()
    # critResist must come before crit (both contain "CRIT")
    if "CRIT" in t:
        if "RESIST" in t or " RES" in t or t.endswith("RES"):
            return "critResist"
        return "crit"
    if "ATK" in t or "ATTACK" in t:
        return "attack"
    if "DEF" in t or "DEFENSE" in t:
        return "defense"
    if "HP" in t:
        return "hp"
    return None


def get_board_data(unit_uid: int, pct_to_layer: dict[int, str]) -> dict[str, list[str]]:
    """
    Scrape board stats for a unit using its numeric uid.
    Active board cells have class 'bg-yellow-500'.
    Percentage in button text maps to layer (3%→layer1, 4%→layer2, 5%→layer3).
    """
    empty: dict[str, list[str]] = {"layer1": [], "layer2": [], "layer3": []}
    url = f"{SOSHAGE_BASE}/unit/{unit_uid}"
    resp = fetch(url)
    if not resp:
        return empty

    soup = BeautifulSoup(resp.text, "html.parser")
    active_btns = soup.find_all("button", class_="bg-yellow-500")

    if not active_btns:
        print(f"  WARNING: no active board buttons found for uid={unit_uid}")
        return empty

    result: dict[str, list[str]] = {"layer1": [], "layer2": [], "layer3": []}
    seen: dict[str, set[str]] = {"layer1": set(), "layer2": set(), "layer3": set()}

    for btn in active_btns:
        if not isinstance(btn, Tag):
            continue
        text = btn.get_text(" ", strip=True)

        # Determine layer from percentage value in text
        pct_match = re.search(r"(\d+)%", text)
        if not pct_match:
            continue
        pct = int(pct_match.group(1))
        layer = pct_to_layer.get(pct)
        if not layer:
            continue

        stat = parse_board_stat(text)
        if stat and stat not in seen[layer]:
            seen[layer].add(stat)
            result[layer].append(stat)

    return result


# ---------------------------------------------------------------------------
# Chinese name extraction
# ---------------------------------------------------------------------------

def get_chinese_name(uid: int, en_name: str) -> str:
    """
    Fetch Traditional Chinese name from soshage.com/trickcal/zh-tw/unit/{uid}.
    Falls back to the English name if the page can't be fetched or parsed.
    """
    url = f"{SOSHAGE_ZH_TW}/unit/{uid}"
    resp = fetch(url)
    if not resp:
        print(f"  WARNING: could not fetch zh-tw page for uid={uid}, using '{en_name}'")
        return en_name
    resp.encoding = "utf-8"
    soup = BeautifulSoup(resp.text, "html.parser")
    h1 = soup.find("h1")
    if isinstance(h1, Tag):
        cn = h1.get_text(strip=True)
        if cn:
            return cn
    print(f"  WARNING: no h1 on zh-tw page for uid={uid}, using '{en_name}'")
    return en_name


# ---------------------------------------------------------------------------
# Portrait download
# ---------------------------------------------------------------------------

def download_portrait(cn_name: str, unit_icon: str, dry_run: bool = False) -> bool:
    """Download unit portrait webp. Returns True on success / already-exists."""
    dest = PORTRAITS_DIR / f"{cn_name}.webp"
    if dest.exists():
        print(f"  portrait exists: {dest.name}")
        return True

    url = HEROICON_CDN.format(icon=unit_icon)
    if dry_run:
        print(f"  [DRY RUN] would download {url} → {dest.name}")
        return True

    resp = fetch(url)
    if not resp:
        print(f"  WARNING: could not download portrait for {cn_name}")
        return False

    PORTRAITS_DIR.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(resp.content)
    print(f"  portrait saved: {dest.name} ({len(resp.content):,} bytes)")
    return True


def download_food_image(food_name: str, dry_run: bool = False) -> bool:
    """
    Download food PNG from lsbim/foods raw CDN, convert PNG→WebP.
    food_name is the canonical name (zh-TW or Korean).
    Returns True on success / already-exists.
    """
    dest = FOOD_IMAGES_DIR / f"{food_name}.webp"
    if dest.exists():
        print(f"  food image exists: {dest.name}")
        return True

    # Resolve Korean name for the download URL
    kr_name = CN_TO_KR.get(food_name, food_name)
    url = get_food_image_url(kr_name)

    if dry_run:
        print(f"  [DRY RUN] would download {url} → {dest.name}")
        return True

    resp = fetch(url)
    if not resp:
        print(f"  WARNING: could not download food image for {food_name!r}")
        return False

    try:
        img = Image.open(io.BytesIO(resp.content)).convert("RGBA")
        FOOD_IMAGES_DIR.mkdir(parents=True, exist_ok=True)
        img.save(dest, format="WEBP", lossless=True)
        print(f"  food image saved: {dest.name} ({dest.stat().st_size:,} bytes)")
    except Exception as exc:
        print(f"  WARNING: failed to convert food image for {food_name!r}: {exc}")
        return False
    return True


# ---------------------------------------------------------------------------
# Per-character processing
# ---------------------------------------------------------------------------

def process_character(
    unit: dict[str, Any],
    cn_name: str,
    en_to_food: dict[str, dict],
    pct_to_layer: dict[int, str],
    dry_run: bool = False,
    skip_images: bool = False,
) -> tuple[str, dict[str, Any], dict[str, list[str]], dict[str, list[str]]]:
    """Build (cn_name, char_entry, board_entry, food_entry) for one soshage news unit."""
    unit_name: str = str(unit.get("name") or "")    # English display name
    unit_icon: str = str(unit.get("icon") or unit_name)  # resource/file name for CDN
    unit_uid: int = int(unit.get("uid") or 0)

    print(f"\n  [{cn_name} / en={unit_name} / icon={unit_icon}]")

    def _map(d: dict[int, str], raw: Any) -> str:
        try:
            return d.get(int(raw), "???")
        except (TypeError, ValueError):
            return "???"

    char_entry: dict[str, Any] = {
        "name": cn_name,
        "en": unit_name,
        "personality": _map(PERSONALITY_MAP, unit.get("personality")),
        "stars": int(unit.get("rarity") or 1),
        "attackType": _map(ATTACK_TYPE_MAP, unit.get("attack_type")),
        "deployRow": _map(DEPLOY_ROW_MAP, unit.get("section")),
        "role": _map(ROLE_MAP, unit.get("job")),
        "race": _map(RACE_MAP, unit.get("tribe")),
    }

    # --- Board ---
    print("    board...")
    if unit_uid:
        board_entry = get_board_data(unit_uid, pct_to_layer)
    else:
        print("    WARNING: no uid, skipping board fetch")
        board_entry = {"layer1": [], "layer2": [], "layer3": []}
    for layer, stats in board_entry.items():
        print(f"    {layer}: {stats}")

    # --- Food (from charInfo.js via lsbim/foods) ---
    print("    food...")
    food_entry = get_food_prefs(unit_name, en_to_food)
    if not any(food_entry.values()):
        print(f"    WARNING: no food data found for '{unit_name}' in charInfo.js")
    else:
        print(f"    veryLike={food_entry['veryLike']}")
        print(f"    like={food_entry['like']}")
        print(f"    dislike={food_entry['dislike']}")

    # --- Portrait (saved under Chinese name) ---
    if not skip_images:
        print("    portrait...")
        download_portrait(cn_name, unit_icon, dry_run=dry_run)

    return cn_name, char_entry, board_entry, food_entry


# ---------------------------------------------------------------------------
# JSON I/O
# ---------------------------------------------------------------------------

def load_json(path: Path) -> dict[str, Any]:
    with open(path, encoding="utf-8") as f:
        return json.load(f)  # type: ignore[return-value]


def save_json(path: Path, data: dict[str, Any], dry_run: bool = False) -> None:
    content = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    if dry_run:
        print(f"  [DRY RUN] would write {path.relative_to(PROJECT_ROOT)}")
        return
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(content)
    print(f"  wrote {path.relative_to(PROJECT_ROOT)}")


def prepend_key(d: dict[str, Any], key: str, value: Any) -> dict[str, Any]:
    return {key: value, **d}


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Trickcal Auto Unit Updater")
    parser.add_argument("--dry-run", action="store_true", help="show changes without writing files")
    parser.add_argument("--skip-images", action="store_true", help="skip portrait downloads")
    args = parser.parse_args()

    print("=== Trickcal Auto Unit Updater ===")
    if args.dry_run:
        print("[DRY RUN — no files will be modified]\n")

    # ---- Load existing data ----
    print("Loading existing JSON data...")
    characters: dict[str, Any] = load_json(CHARACTERS_JSON)
    board_data: dict[str, Any] = load_json(BOARD_JSON)
    food_data: dict[str, Any] = load_json(FOOD_JSON)
    foods_catalogue: dict[str, Any] = load_json(FOODS_CATALOGUE_JSON)
    known_names: set[str] = set(characters.keys())

    # Build bonus-per-cell → layer name mapping from boardConfig
    pct_to_layer: dict[int, str] = {}
    for layer_name, cfg in board_data.get("boardConfig", {}).items():
        bonus = cfg.get("bonusPerCell")
        if isinstance(bonus, int):
            pct_to_layer[bonus] = layer_name
    if not pct_to_layer:
        pct_to_layer = {3: "layer1", 4: "layer2", 5: "layer3"}  # fallback
    print(f"  {len(known_names)} known characters  |  pct->layer: {pct_to_layer}")

    # ---- Clone lsbim/foods for food data ----
    tmp = Path(tempfile.gettempdir()) / "trickcal_lsbim_foods_units"
    print("\nCloning lsbim/foods (sparse)...")
    try:
        clone_lsbim_foods(tmp)
        print("  done")
    except Exception as exc:
        print(f"  WARNING: lsbim/foods clone failed: {exc}")
        print("  Food data for new characters will be empty.")
        tmp = None  # type: ignore[assignment]

    try:
        _run_main(args, characters, board_data, food_data, foods_catalogue,
                  known_names, pct_to_layer, tmp)
    finally:
        if tmp is not None and tmp.exists():
            _rmtree(tmp)
            print("\n  cleaned up temp dir")


def _run_main(
    args: argparse.Namespace,
    characters: dict[str, Any],
    board_data: dict[str, Any],
    food_data: dict[str, Any],
    foods_catalogue: dict[str, Any],
    known_names: set[str],
    pct_to_layer: dict[int, str],
    repo: "Path | None",
) -> None:
    # ---- Load food reference data from lsbim/foods ----
    kr_to_grade: dict[str, int] = {}
    en_to_food: dict[str, dict] = {}

    if repo is not None:
        try:
            kr_to_grade    = load_food_grades(repo)
            char_food_info = load_char_food_info(repo)
            en_to_food     = build_en_to_food(char_food_info)
            print(f"  {len(kr_to_grade)} foods loaded  |  "
                  f"{len(en_to_food)} chars with food data in charInfo.js")
        except Exception as exc:
            print(f"  WARNING: failed to load lsbim/foods data: {exc}")

    # ---- Fetch news ----
    print("\nFetching character list from soshage.com...")
    news = get_news_entries()
    if not news:
        print("ERROR: no news entries retrieved. Check soshage scraping logic.")
        sys.exit(1)
    print(f"  {len(news)} news entries")

    # ---- Scan for new characters ----
    print("\nScanning news for new characters...")
    new_chars: list[tuple[str, dict[str, Any], dict[str, list[str]], dict[str, list[str]]]] = []
    processed: set[str] = set()

    # Build known-EN set once (cheaper than rebuilding per iteration)
    known_en_names: set[str] = {
        str(v.get("en") or "").lower()
        for v in characters.values()
        if isinstance(v, dict)
    }
    # Build known-CN set for fallback (catches EN spelling mismatches)
    known_cn_names: set[str] = set(characters.keys())

    for entry in news:
        if not isinstance(entry, dict):
            continue
        unit: dict[str, Any] = entry.get("unit") or {}
        if not isinstance(unit, dict):
            continue

        unit_name: str = str(unit.get("name") or "").strip()
        if not unit_name:
            continue

        # Fast path: skip already-known characters by EN name
        if unit_name.lower() in known_en_names:
            print(f"  skip known: {unit_name}")
            continue

        if unit_name in processed:
            continue
        processed.add(unit_name)

        # Fetch Chinese name early so we can check against known CN names
        # (catches EN spelling mismatches like "Epica" vs "Epika")
        unit_uid: int = int(unit.get("uid") or 0)
        print(f"\n  [{unit_name} / uid={unit_uid}]")
        print("    fetching Chinese name...")
        cn_name: str = get_chinese_name(unit_uid, unit_name) if unit_uid else unit_name
        print(f"    Chinese name: {cn_name}")

        if cn_name in known_cn_names:
            print(f"  skip known (CN match): {unit_name} = {cn_name}")
            known_en_names.add(unit_name.lower())  # cache to avoid re-fetching duplicates
            continue

        cn_name, char_entry, board_entry, food_entry = process_character(
            unit, cn_name, en_to_food, pct_to_layer,
            dry_run=args.dry_run, skip_images=args.skip_images,
        )
        new_chars.append((cn_name, char_entry, board_entry, food_entry))

    # ---- Summary ----
    print(f"\n=== {len(new_chars)} new character(s) ===")
    if not new_chars:
        print("Nothing to add — already up to date.")
        return

    print()
    for cn_key, ce, _, _ in new_chars:
        stars_str = "★" * int(ce.get("stars") or 1)
        print(f"  + {cn_key} ({ce['en']})  {stars_str}  {ce['race']}  {ce['role']}  {ce['attackType']}")

    if args.dry_run:
        # Preview new food catalogue entries + image downloads
        new_catalogue_preview: dict[str, Any] = {}
        for _, _, _, food_entry in new_chars:
            for bucket in ("veryLike", "like", "dislike"):
                for name in food_entry.get(bucket, []):
                    if name not in foods_catalogue and name not in new_catalogue_preview:
                        kr_key = CN_TO_KR.get(name, name)
                        rarity = food_rarity(kr_key, kr_to_grade.get(kr_key, 1))
                        new_catalogue_preview[name] = {"rarity": rarity}
        if new_catalogue_preview:
            print("\n[DRY RUN] would add to foods.json:")
            for name, entry in new_catalogue_preview.items():
                img_exists = (FOOD_IMAGES_DIR / f"{name}.webp").exists()
                img_status = "image exists" if img_exists else "would download image"
                print(f"  + {name!r} ({entry['rarity']})  [{img_status}]")
        print("\n[DRY RUN] skipping file writes.")
        return

    # ---- Write JSON files (append to end) ----
    print("\nWriting JSON files...")

    for cn_key, char_entry, _, _ in new_chars:
        characters[cn_key] = char_entry
    save_json(CHARACTERS_JSON, characters)

    char_boards: dict[str, Any] = board_data.get("characterBoards") or {}
    for cn_key, _, board_entry, _ in new_chars:
        char_boards[cn_key] = board_entry
    board_data["characterBoards"] = char_boards
    save_json(BOARD_JSON, board_data)

    for cn_key, _, _, food_entry in new_chars:
        food_data[cn_key] = food_entry
    save_json(FOOD_JSON, food_data)

    # Add any new food items to the catalogue (foods.json)
    # Rarity determined from foodInfo-ko.js grade (not from preference bucket).
    new_catalogue_entries: dict[str, Any] = {}
    for _, _, _, food_entry in new_chars:
        for bucket in ("veryLike", "like", "dislike"):
            for name in food_entry.get(bucket, []):
                if name not in foods_catalogue and name not in new_catalogue_entries:
                    kr_key = CN_TO_KR.get(name, name)
                    rarity = food_rarity(kr_key, kr_to_grade.get(kr_key, 1))
                    new_catalogue_entries[name] = {"rarity": rarity}

    if new_catalogue_entries:
        for name, entry in new_catalogue_entries.items():
            foods_catalogue[name] = entry
            print(f"  + foods.json: {name!r} ({entry['rarity']})")
        save_json(FOODS_CATALOGUE_JSON, foods_catalogue)

    # Download images for new food catalogue entries (skip if --skip-images)
    if new_catalogue_entries and not args.skip_images:
        print("\nDownloading food images...")
        for name in new_catalogue_entries:
            download_food_image(name, dry_run=False)

    print("\nDone. Verify with: git diff --stat")


if __name__ == "__main__":
    main()
