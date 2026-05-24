#!/usr/bin/env python3
"""
lsbim_foods.py — Shared utilities for the lsbim/foods GitHub data source.

Provides:
  KR_TO_CN / CN_TO_KR  — hardcoded Korean ↔ Traditional-Chinese food name maps
  grade_to_rarity()    — KR grade (0–5) → "common" / "uncommon" / "rare"
  translate_food()     — single KR name → canonical (CN if known, else KR)
  translate_foods()    — list of KR names → canonical list (deduped)
  get_food_image_url() — raw.githubusercontent.com PNG URL for a KR food name
  clone_lsbim_foods()  — sparse-clone the repo to a local directory
  load_food_grades()   — parse foodInfo-ko.js → {kr_name: grade}
  load_char_food_info()— parse charInfo.js   → {kr_char: {en, food}}
  build_en_to_cn()     — {en_lower: cn_name} from characters.json (with aliases)
  build_en_to_food()   — {en_lower: food_dict} from charInfo.js data
  get_food_prefs()     — full food-pref lookup by EN name → {veryLike, like, dislike}
"""
from __future__ import annotations

import json
import os
import re
import shutil
import stat
import subprocess
from pathlib import Path
from typing import Any
from urllib.parse import quote


def _rmtree(path: Path) -> None:
    """shutil.rmtree with read-only fix for Windows .git objects."""
    def _on_error(func, fpath, exc_info):  # noqa: ANN001
        os.chmod(fpath, stat.S_IWRITE)
        func(fpath)
    shutil.rmtree(path, onerror=_on_error)

# ---------------------------------------------------------------------------
# Korean → Traditional Chinese food name map
# Covers the 30 "global-era" foods that already have zh-TW canonical names in
# foods.json.  All other KR foods use their Korean name as canonical.
# Verified by cross-referencing character preference lists in both data sources.
# ---------------------------------------------------------------------------
KR_TO_CN: dict[str, str] = {
    # KR grade 4 (rare in our system)
    "초콜릿 아이스크림":       "巧克力冰淇淋",
    "만화 고기 구이":          "烤漫畫肉",
    "비밀의 포도주스":         "秘密葡萄汁",
    "멜론 보코치니":           "哈蜜瓜博孔奇尼起司",
    "유령 푸딩":               "幽靈布丁",
    "보석 타르트":             "寶石塔",
    "민트 초코 아이스크림":    "薄荷巧克力冰淇淋",
    "쌀밥 한 공기":            "一碗米飯",
    # KR grade 3 (rare or uncommon in our system depending on origin)
    "석류석 열매":             "石榴果實",
    "미숫가루":                "麵茶",
    "허니갈릭 살몬":           "蜂蜜大蒜鮭魚",
    "따뜻한 아이스 아메리카노":"溫熱的冰美式咖啡",
    "해초 샐러드":             "海藻沙拉",
    "호박 스프":               "南瓜濃湯",
    # KR grade 2 (uncommon in our system)
    "크림 브륄레":             "焦糖布丁",
    "매듭 빵":                 "扭結麵包",
    "한입초 쌈":               "一口草生菜包",
    "공기 커틀릿":             "空氣炸豬排",
    "금탕후루":                "金糖葫蘆",
    "코코넛 솔잎죽":           "椰子松針粥",
    # KR grade 1 (common in our system)
    "딸기 케이크":             "草莓蛋糕",
    "캬라멜 팝콘":             "焦糖爆米花",
    "캔 사료":                 "獸糧罐頭",
    "레몬차":                  "檸檬茶",
    "우주식량":                "太空食品",
    "꿀단지":                  "蜂蜜罐",
    "계피맛 알사탕":           "肉桂口味糖果",
    "용족 사탕":               "龍族糖果",
    "UFC 당근 튀김":           "UFC炸胡蘿蔔",
    "마시멜로 마카롱":         "棉花糖馬卡龍",
}

# Reverse map: Traditional Chinese canonical → Korean name
CN_TO_KR: dict[str, str] = {v: k for k, v in KR_TO_CN.items()}

# EN name aliases: charInfo.js english name (lowercase) → characters.json english name (lowercase)
# Required when the two sources spell the same character's EN name differently.
_EN_ALIASES: dict[str, str] = {
    "rude":    "rudd",
    "epica":   "epika",
    "selline": "selene",
    "lazy":    "layze",
}

# lsbim/foods raw CDN base
_LSBIM_RAW = "https://raw.githubusercontent.com/lsbim/foods/master"


# ---------------------------------------------------------------------------
# Rarity helpers
# ---------------------------------------------------------------------------

def grade_to_rarity(grade: int) -> str:
    """KR food grade (0–5) → rarity string."""
    if grade >= 5:
        return "legendary"
    if grade >= 4:
        return "rare"
    if grade >= 2:
        return "uncommon"
    return "common"


# Per-food rarity overrides (KR name → rarity).
# Use when the grade-based calculation gives the wrong result.
_RARITY_OVERRIDES: dict[str, str] = {
    "927곡 미숫가루":     "legendary",
    "석류석 화채":        "legendary",
    "석류석 열매":        "rare",
    "미숫가루":           "rare",
    "수소 커틀릿":        "rare",
    "백금탕후루":         "rare",
    "유기농 레몬차":      "rare",
    "하트 매듭 빵":       "rare",
    "코코넛 만능 녹즙":   "rare",
    "소프트 크림 브륄레": "rare",
    "두입초 쌈":          "rare",
    "레몬차":             "common",
}


def food_rarity(kr_name: str, grade: int) -> str:
    """Return rarity for a food, checking per-food overrides before grade lookup."""
    return _RARITY_OVERRIDES.get(kr_name, grade_to_rarity(grade))


def translate_food(kr: str) -> str:
    """Korean food name → canonical name (zh-TW if known, otherwise Korean)."""
    return KR_TO_CN.get(kr, kr)


def translate_foods(kr_list: list[str]) -> list[str]:
    """Translate a list of Korean food names → canonical names (deduped, order preserved)."""
    result: list[str] = []
    seen: set[str] = set()
    for kr in kr_list:
        canonical = KR_TO_CN.get(kr, kr)
        if canonical not in seen:
            result.append(canonical)
            seen.add(canonical)
    return result


def get_food_image_url(kr_name: str) -> str:
    """Return the raw GitHub webp URL for a Korean food name."""
    return f"{_LSBIM_RAW}/public/images/food/{quote(kr_name, safe='')}.webp"


# ---------------------------------------------------------------------------
# Sparse clone
# ---------------------------------------------------------------------------

def clone_lsbim_foods(dest: Path) -> None:
    """
    Sparse-clone lsbim/foods to *dest*, checking out only:
      src/data/food/   (foodInfo-ko.js, foodInfo-global.js)
      src/data/i18n/   (charInfo.js)
    Removes *dest* first if it already exists.
    """
    if dest.exists():
        _rmtree(dest)
    _run(["git", "clone", "--no-checkout", "--depth=1", "--filter=blob:none",
          "https://github.com/lsbim/foods.git", str(dest)])
    _run(["git", "-C", str(dest), "sparse-checkout", "init", "--cone"])
    _run(["git", "-C", str(dest), "sparse-checkout", "set",
          "src/data/food", "src/data/i18n"])
    _run(["git", "-C", str(dest), "checkout"])


def _run(cmd: list[str]) -> None:
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(
            f"Command failed: {' '.join(cmd)}\nstdout: {r.stdout}\nstderr: {r.stderr}"
        )


# ---------------------------------------------------------------------------
# Parse foodInfo-ko.js
# ---------------------------------------------------------------------------

def load_food_grades(repo_dir: Path) -> dict[str, int]:
    """Parse foodInfo-ko.js → {korean_food_name: grade (0–5)}."""
    path = repo_dir / "src" / "data" / "food" / "foodInfo-ko.js"
    content = path.read_text(encoding="utf-8")
    kr_to_grade: dict[str, int] = {}
    for m in re.finditer(r'foodGradeKo\[(\d+)\]\s*=\s*\[(.*?)\]', content, re.DOTALL):
        grade = int(m.group(1))
        for name in re.findall(r'"([^"]+)"', m.group(2)):
            kr_to_grade[name] = grade
    return kr_to_grade


# ---------------------------------------------------------------------------
# Parse charInfo.js
# ---------------------------------------------------------------------------

def load_char_food_info(repo_dir: Path) -> dict[str, dict[str, Any]]:
    """
    Parse charInfo.js from lsbim/foods.
    Returns {kr_char_name: {"en": str, "food": {"verylike", "like", "hate", "soso"}}}
    """
    path = repo_dir / "src" / "data" / "i18n" / "charInfo.js"
    content = path.read_text(encoding="utf-8")
    json_str = _charinfo_js_to_json(content)
    try:
        data: dict[str, Any] = json.loads(json_str)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Failed to parse charInfo.js as JSON: {exc}") from exc

    result: dict[str, dict[str, Any]] = {}
    for kr_name, entry in data.items():
        if not isinstance(entry, dict):
            continue
        names = entry.get("names") or {}
        en = str(names.get("en") or "")
        food = entry.get("food") or {}
        result[kr_name] = {
            "en": en,
            "food": {
                "verylike": list(food.get("verylike") or []),
                "like":     list(food.get("like")     or []),
                "hate":     list(food.get("hate")     or []),
                "soso":     list(food.get("soso")     or []),
            },
        }
    return result


def _charinfo_js_to_json(content: str) -> str:
    """Convert the charInfo JS object literal to valid JSON."""
    # Locate "export const charInfo = {"
    m = re.search(r'export\s+const\s+charInfo\s*=\s*\{', content)
    if not m:
        raise ValueError("charInfo declaration not found in charInfo.js")
    obj_start = content.index("{", m.start())

    # Find the matching closing brace (respects nested braces and strings)
    depth = 0
    in_str = False
    escape = False
    obj_end = -1
    for i, c in enumerate(content[obj_start:], obj_start):
        if escape:
            escape = False
            continue
        if c == "\\" and in_str:
            escape = True
            continue
        if c == '"':
            in_str = not in_str
            continue
        if in_str:
            continue
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                obj_end = i
                break
    if obj_end == -1:
        raise ValueError("Could not find end of charInfo object")

    obj = content[obj_start : obj_end + 1]

    # 1. Remove // comments
    obj = re.sub(r"//[^\n]*", "", obj)

    # 2. Convert single-quoted keys like 'zh-CN': → "zh-CN":
    obj = re.sub(r"'([^']+)'(\s*:)", r'"\1"\2', obj)

    # 3. Quote bare identifier keys  (preceded by { , or \n)
    def _quote(m: re.Match) -> str:
        return m.group(0).replace(m.group(1), f'"{m.group(1)}"', 1)

    obj = re.sub(
        r'(?<=[{,\n])\s*([a-zA-Z_][a-zA-Z0-9_]*)(?=\s*:)',
        _quote,
        obj,
    )

    # 4. Remove trailing commas before } or ]
    obj = re.sub(r",(\s*[}\]])", r"\1", obj)

    return obj


# ---------------------------------------------------------------------------
# Lookup helpers used by both updater scripts
# ---------------------------------------------------------------------------

def build_en_to_cn(characters: dict[str, Any]) -> dict[str, str]:
    """
    Build {en_name_lower: cn_name} from characters.json.
    Also inserts aliases so charInfo.js EN spellings resolve correctly.
    """
    en_to_cn: dict[str, str] = {}
    for cn_name, v in characters.items():
        if not isinstance(v, dict):
            continue
        en = str(v.get("en") or "").lower()
        if en:
            en_to_cn[en] = cn_name
    # Add charInfo → characters.json aliases
    for charinfo_en, chars_en in _EN_ALIASES.items():
        if chars_en in en_to_cn:
            en_to_cn.setdefault(charinfo_en, en_to_cn[chars_en])
    return en_to_cn


def build_en_to_food(char_food_info: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """
    Build {en_name_lower: food_prefs} from load_char_food_info() output.
    food_prefs = {"verylike": [...], "like": [...], "hate": [...], "soso": [...]}
    """
    result: dict[str, dict[str, Any]] = {}
    for info in char_food_info.values():
        en = (info.get("en") or "").lower()
        if en:
            result[en] = info["food"]
    return result


def get_food_prefs(
    unit_en: str,
    en_to_food: dict[str, dict[str, Any]],
) -> dict[str, list[str]]:
    """
    Return translated food preferences for a character by their English name.
    Handles known EN-name mismatches via _EN_ALIASES.
    Returns {"veryLike": [...], "like": [...], "dislike": [...]}.
    """
    en_lower = unit_en.lower()
    food = en_to_food.get(en_lower)

    if food is None:
        # Try aliases both ways
        for a, b in _EN_ALIASES.items():
            if en_lower == a:
                food = en_to_food.get(b)
            elif en_lower == b:
                food = en_to_food.get(a)
            if food is not None:
                break

    if food is None:
        return {"veryLike": [], "like": [], "dislike": []}

    return {
        "veryLike": translate_foods(food.get("verylike") or []),
        "like":     translate_foods(food.get("like")     or []),
        "dislike":  translate_foods(food.get("hate")     or []),
    }
