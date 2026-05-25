#!/usr/bin/env python3
"""
Shared equip image download & compositing for Trickcal updaters.
Usage: none — imported by update_stages.py and update_gear.py
"""

import io
import sys
from pathlib import Path

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

SCRIPT_DIR = Path(__file__).parent.resolve()
UPDATER_DIR = SCRIPT_DIR
PROJECT_ROOT = SCRIPT_DIR.parent.parent.resolve()
GEARS_DIR = PROJECT_ROOT / "public" / "assets" / "gears"

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


def download_equip_image(name: str, icon: str, rarity: int, dry_run: bool = False) -> bool:
    """Download equip icon from CDN, composite on rarity bg, save as webp."""
    dest = GEARS_DIR / f"{name}.webp"
    if dest.exists():
        return True

    url = EQUIPICON_CDN.format(icon=icon)

    if dry_run:
        print(f"  [DRY] would download {url} -> {dest.name}")
        return True

    data = fetch_binary(url)
    if not data:
        print(f"  WARN: could not download image for {name!r} (icon={icon})")
        return False

    GEARS_DIR.mkdir(parents=True, exist_ok=True)

    bg_name = _RARITY_BG.get(rarity)
    if bg_name is None:
        print(f"  WARN: no background for rarity {rarity}, saving {name!r} raw")
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
