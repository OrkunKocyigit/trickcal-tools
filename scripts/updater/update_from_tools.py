#!/usr/bin/env python3
"""
Update website data from bundled trickcal-tools.exe.

Workflow:
  1. Run trickcal-tools.exe all in temp dir.
  2. Adapt JSON output to website layout.
  3. Copy/composite images into public/assets.

Character names stay on current website keys so local storage keeps working.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

try:
    from PIL import Image  # type: ignore[import-untyped]
except ImportError:
    print("ERROR: Missing deps. Run: .venv/Scripts/pip install -r requirements.txt", file=sys.stderr)
    sys.exit(1)

RESAMPLE_LANCZOS = getattr(getattr(Image, "Resampling", Image), "LANCZOS")


SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent.parent.resolve()
PUBLIC_ROOT = PROJECT_ROOT / "public"
TOOLS_EXE = SCRIPT_DIR / "trickcal-tools.exe"
TEMP_ROOT = Path(tempfile.gettempdir()) / "trickcal-updater"

RAW_BG_FILES: dict[int, str] = {
    1: "common",
    2: "uncommon",
    3: "rare",
    4: "legendary",
}

FOOD_BG_FILES = RAW_BG_FILES


def load_json(path: Path, default: Any | None = None) -> Any:
    if not path.exists():
        return {} if default is None else default
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def save_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


def load_tool_output(work_dir: Path) -> dict[str, Any]:
    return {
        "characters": load_json(work_dir / "characters.json"),
        "gear": load_json(work_dir / "gear.json"),
        "material": load_json(work_dir / "material.json"),
        "foods": load_json(work_dir / "foods.json"),
        "food_data": load_json(work_dir / "food-data.json"),
        "sweep": load_json(work_dir / "sweep.json"),
        "boards": load_json(work_dir / "characterBoards.json"),
        "assets": work_dir / "assets",
    }


def index_by_id(data: dict[str, Any]) -> dict[str, tuple[str, dict[str, Any]]]:
    result: dict[str, tuple[str, dict[str, Any]]] = {}
    for name, entry in data.items():
        if isinstance(entry, dict) and entry.get("id") is not None:
            result[str(entry["id"])] = (name, entry)
    return result


def merge_characters(current: dict[str, Any], tool: dict[str, Any]) -> dict[str, Any]:
    tool_by_id = index_by_id(tool)
    merged: dict[str, Any] = {}
    seen_ids: set[str] = set()

    for current_name, current_entry in current.items():
        if not isinstance(current_entry, dict):
            merged[current_name] = current_entry
            continue

        uid = current_entry.get("id")
        tool_item = tool_by_id.get(str(uid)) if uid is not None else None
        if tool_item is None:
            merged[current_name] = current_entry
            continue

        _, tool_entry = tool_item
        item = dict(current_entry)
        for key, value in tool_entry.items():
            if key == "name":
                continue
            item[key] = value
        item["name"] = current_name
        merged[current_name] = item
        seen_ids.add(str(uid))

    for tool_name, tool_entry in tool.items():
        uid = tool_entry.get("id")
        if uid is not None and str(uid) in seen_ids:
            continue
        merged[tool_name] = dict(tool_entry)

    return merged


def current_character_order(current: dict[str, Any], merged: dict[str, Any]) -> dict[str, Any]:
    ordered: dict[str, Any] = {}

    for current_name, current_entry in current.items():
        if not isinstance(current_entry, dict):
            continue
        if current_name in merged:
            ordered[current_name] = merged[current_name]

    for name, value in merged.items():
        if name not in ordered:
            ordered[name] = value

    return ordered


def merge_board_data(
    current_board: dict[str, Any],
    output_chars: dict[str, Any],
    tool_boards: dict[str, Any],
    tool_chars: dict[str, Any],
) -> dict[str, Any]:
    tool_by_id = index_by_id(tool_chars)
    boards: dict[str, Any] = {}

    for output_name, output_entry in output_chars.items():
        if not isinstance(output_entry, dict):
            continue
        uid = output_entry.get("id")
        if uid is None:
            continue
        tool_item = tool_by_id.get(str(uid))
        if tool_item is None:
            continue
        tool_name, _ = tool_item
        payload = tool_boards.get(tool_name)
        if payload is None:
            continue
        boards[output_name] = payload

    result = dict(current_board)
    result["characterBoards"] = boards
    return result


def merge_food_prefs(
    tool_food_prefs: dict[str, Any],
    output_chars: dict[str, Any],
    tool_chars: dict[str, Any],
    current_food_prefs: dict[str, Any],
) -> dict[str, Any]:
    tool_by_id = index_by_id(tool_chars)
    prefs: dict[str, Any] = {
        name: value
        for name, value in current_food_prefs.items()
        if name in output_chars
    }

    for output_name, output_entry in output_chars.items():
        if not isinstance(output_entry, dict):
            continue
        uid = output_entry.get("id")
        if uid is None:
            continue
        tool_item = tool_by_id.get(str(uid))
        if tool_item is None:
            continue
        tool_name, _ = tool_item
        payload = tool_food_prefs.get(tool_name)
        if payload is None:
            continue
        prefs[output_name] = payload

    ordered: dict[str, Any] = {}
    for output_name in output_chars.keys():
        if output_name in prefs:
            ordered[output_name] = prefs[output_name]
    for name, payload in prefs.items():
        if name not in ordered:
            ordered[name] = payload
    return ordered


def update_food_locale(
    locale_data: dict[str, Any],
    tool_foods: dict[str, Any],
    translation_field: str | None = None,
) -> dict[str, Any]:
    food_section = dict(locale_data.get("food") or {})
    current_items = dict(food_section.get("items") or {})

    items: dict[str, str] = {}
    for name, entry in tool_foods.items():
        if not isinstance(entry, dict):
            continue
        if translation_field is None:
            items[name] = str(current_items.get(name) or name)
        else:
            items[name] = str(entry.get(translation_field) or name)

    food_section["items"] = items
    locale_data["food"] = food_section
    return locale_data


def sort_sweep_data(sweep_data: dict[str, Any]) -> dict[str, Any]:
    def sweep_sort_key(item: tuple[str, Any]) -> tuple[int, int, str]:
        name, entry = item
        if not isinstance(entry, dict):
            return (sys.maxsize, sys.maxsize, name)

        try:
            rank = int(entry.get("rank") or 0)
        except (TypeError, ValueError):
            rank = 0

        try:
            uid = int(entry.get("uid") or 0)
        except (TypeError, ValueError):
            uid = 0

        return (rank, uid, name)

    return dict(sorted(sweep_data.items(), key=sweep_sort_key))


def copy_binary(src: Path, dest: Path) -> bool:
    if not src.exists():
        return False
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dest)
    return True


def compose_equip_image(src: Path, dest: Path, rarity: int, item_type: str = "gear") -> bool:
    if not src.exists():
        return False

    rarity = int(rarity) if rarity is not None else 0
    bg_name = RAW_BG_FILES.get(rarity)
    if bg_name is None:
        if rarity > 4:
            bg_name = f"{item_type}_{rarity}"
        else:
            return copy_binary(src, dest)

    bg_path = SCRIPT_DIR / f"{bg_name}.webp"
    if not bg_path.exists():
        return copy_binary(src, dest)

    try:
        bg = Image.open(bg_path).convert("RGBA")
        canvas_w, canvas_h = bg.size
        canvas = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))

        inset = 5
        bg_small = bg.resize((canvas_w - inset * 2, canvas_h - inset * 2), RESAMPLE_LANCZOS)
        canvas.paste(bg_small, (inset, inset), bg_small)

        icon = Image.open(src).convert("RGBA")
        icon_w = icon.width * 6 // 10
        icon_h = icon.height * 6 // 10
        icon_small = icon.resize((icon_w, icon_h), RESAMPLE_LANCZOS)
        x = (canvas_w - icon_w) // 2
        y = (canvas_h - icon_h) // 2
        canvas.paste(icon_small, (x, y), icon_small)

        dest.parent.mkdir(parents=True, exist_ok=True)
        canvas.save(dest, format="WEBP", lossless=True)
        return True
    except Exception:
        return copy_binary(src, dest)


def process_character_images(
    temp_assets: Path,
    output_chars: dict[str, Any],
    tool_chars: dict[str, Any],
) -> None:
    tool_by_id = index_by_id(tool_chars)
    dest_dir = PUBLIC_ROOT / "assets" / "characters"
    src_dir = temp_assets / "characters"

    for output_name, output_entry in output_chars.items():
        if not isinstance(output_entry, dict):
            continue
        uid = output_entry.get("id")
        if uid is None:
            continue
        tool_item = tool_by_id.get(str(uid))
        if tool_item is None:
            continue
        tool_name, _ = tool_item
        src = src_dir / f"{tool_name}.webp"
        dest = dest_dir / f"{output_name}.webp"
        copy_binary(src, dest)


def process_food_images(tool_foods: dict[str, Any], temp_assets: Path) -> None:
    src_dir = temp_assets / "foods"
    dest_dir = PUBLIC_ROOT / "assets" / "foods"
    for name, entry in tool_foods.items():
        if not isinstance(entry, dict):
            continue
        src = src_dir / f"{name}.webp"
        dest = dest_dir / f"{name}.webp"
        rarity = str(entry.get("rarity") or "common")
        bg_key = {
            "common": 1,
            "uncommon": 2,
            "rare": 3,
            "legendary": 4,
        }.get(rarity, 1)
        bg_name = FOOD_BG_FILES.get(bg_key, "common")
        bg_path = SCRIPT_DIR / f"{bg_name}.webp"
        if not src.exists() or not bg_path.exists():
            copy_binary(src, dest)
            continue

        try:
            bg = Image.open(bg_path).convert("RGBA")
            canvas_w, canvas_h = bg.size

            icon = Image.open(src).convert("RGBA")
            icon_w = max(1, icon.width * 65 // 100)
            icon_h = max(1, icon.height * 65 // 100)
            icon_small = icon.resize((icon_w, icon_h), RESAMPLE_LANCZOS)

            result = bg.copy()
            x = (canvas_w - icon_w) // 2
            y = (canvas_h - icon_h) // 2
            result.paste(icon_small, (x, y), icon_small)

            dest.parent.mkdir(parents=True, exist_ok=True)
            result.save(dest, format="WEBP", lossless=True)
        except Exception:
            copy_binary(src, dest)


def process_equip_images(tool_items: dict[str, Any], temp_assets: Path, item_type: str = "gear") -> None:
    gear_src = temp_assets / "gears"
    material_src = temp_assets / "materials"
    dest_dir = PUBLIC_ROOT / "assets" / "gears"

    for uid, entry in tool_items.items():
        if not isinstance(entry, dict):
            continue
        display_name = str(entry.get("name") or uid)
        src = gear_src / f"{display_name}.webp"
        if not src.exists():
            src = material_src / f"{display_name}.webp"
        rarity = int(entry.get("rarity") or 1)
        dest = dest_dir / f"{display_name}.webp"
        compose_equip_image(src, dest, rarity, item_type)


def run_tool_extractor(work_dir: Path, version: str | None, no_images: bool) -> None:
    if not TOOLS_EXE.exists():
        raise FileNotFoundError(f"Missing bundled executable: {TOOLS_EXE}")

    cmd = [str(TOOLS_EXE), "all"]
    if version:
        cmd += ["--version", version]
    if no_images:
        cmd += ["--no-images"]
    cmd += ["--image-path", str(work_dir / "assets")]

    subprocess.run(cmd, cwd=work_dir, check=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Update website data from trickcal-tools.exe")
    parser.add_argument("--version", help="Game version override")
    parser.add_argument("--no-images", action="store_true", help="Skip image processing")
    parser.add_argument("--dry-run", action="store_true", help="Run extractor, write nothing")
    args = parser.parse_args()

    TEMP_ROOT.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="trickcal-tools-", dir=TEMP_ROOT) as tmp:
        work_dir = Path(tmp)
        run_tool_extractor(work_dir, args.version, args.no_images)
        tool = load_tool_output(work_dir)

        current_chars = load_json(PUBLIC_ROOT / "shared" / "characters.json")
        current_board = load_json(PUBLIC_ROOT / "board" / "data.json")
        current_food_prefs = load_json(PUBLIC_ROOT / "food" / "data.json")
        current_en = load_json(PROJECT_ROOT / "src" / "i18n" / "locales" / "en.json")
        current_zh_tw = load_json(PROJECT_ROOT / "src" / "i18n" / "locales" / "zh-TW.json")

        merged_chars = merge_characters(current_chars, tool["characters"])
        ordered_chars = current_character_order(current_chars, merged_chars)
        merged_board = merge_board_data(current_board, ordered_chars, tool["boards"], tool["characters"])
        merged_food_prefs = merge_food_prefs(tool["food_data"], ordered_chars, tool["characters"], current_food_prefs)
        merged_food_catalog = dict(tool["foods"])
        merged_en = update_food_locale(current_en, tool["foods"], "nameEn")
        merged_zh_tw = update_food_locale(current_zh_tw, tool["foods"])
        sorted_sweep = sort_sweep_data(tool["sweep"])

        if args.dry_run:
            print(f"Would write {len(merged_chars)} characters")
            print(f"Would write {len(tool['gear'])} gear items")
            print(f"Would write {len(tool['material'])} material items")
            print(f"Would write {len(merged_food_catalog)} foods")
            print(f"Would write {len(merged_food_prefs)} food prefs")
            print(f"Would write {len(sorted_sweep)} sweep entries")
            print(f"Would write {len(merged_board.get('characterBoards') or {})} boards")
            return

        save_json(PUBLIC_ROOT / "shared" / "characters.json", ordered_chars)
        save_json(PUBLIC_ROOT / "gear" / "data.json", tool["gear"])
        save_json(PUBLIC_ROOT / "gear" / "material.json", tool["material"])
        save_json(PUBLIC_ROOT / "food" / "foods.json", merged_food_catalog)
        save_json(PUBLIC_ROOT / "food" / "data.json", merged_food_prefs)
        save_json(PUBLIC_ROOT / "sweep" / "data.json", sorted_sweep)
        save_json(PUBLIC_ROOT / "board" / "data.json", merged_board)
        save_json(PROJECT_ROOT / "src" / "i18n" / "locales" / "en.json", merged_en)
        save_json(PROJECT_ROOT / "src" / "i18n" / "locales" / "zh-TW.json", merged_zh_tw)

        if not args.no_images:
            process_character_images(tool["assets"], ordered_chars, tool["characters"])
            process_equip_images(tool["gear"], tool["assets"], "gear")
            process_equip_images(tool["material"], tool["assets"], "material")
            process_food_images(tool["foods"], tool["assets"])


if __name__ == "__main__":
    main()
