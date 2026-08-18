# -*- coding: utf-8 -*-
"""
Готовит фотографии вагонов для сайта из docs/Photo/ (сырые файлы, как их
положил пользователь) в docs/photos/ (полный кадр для карточки вагона) и
docs/photos/thumb/ (миниатюра для сетки каталога), по имени вагона (W0xx.jpg).

Сопоставление файл -> вагон берётся из photo_match_results.json (см.
match_photos.py). Источник в docs/Photo/ не трогаем.
"""
import json
import os
from pathlib import Path
from PIL import Image

BASE = Path(__file__).parent
SRC_DIR = BASE.parent / "docs" / "Photo"
OUT_DIR = BASE.parent / "docs" / "photos"
THUMB_DIR = OUT_DIR / "thumb"
MATCH_FILE = BASE / "photo_match_results.json"

FULL_MAX_W = 1000
THUMB_MAX_W = 420
FULL_QUALITY = 82
THUMB_QUALITY = 75


def save_resized(im, max_w, quality, dest):
    if im.mode != "RGB":
        im = im.convert("RGB")
    if im.width > max_w:
        h = round(im.height * max_w / im.width)
        im = im.resize((max_w, h), Image.LANCZOS)
    im.save(dest, "JPEG", quality=quality, optimize=True)


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    THUMB_DIR.mkdir(parents=True, exist_ok=True)

    data = json.load(open(MATCH_FILE, encoding="utf-8"))
    matched = data["matched"]

    done = 0
    for r in matched:
        src = SRC_DIR / r["file"]
        vid = r["vagonId"]
        im = Image.open(src)
        save_resized(im, FULL_MAX_W, FULL_QUALITY, OUT_DIR / f"{vid}.jpg")
        im2 = Image.open(src)
        save_resized(im2, THUMB_MAX_W, THUMB_QUALITY, THUMB_DIR / f"{vid}.jpg")
        done += 1

    full_size = sum(f.stat().st_size for f in OUT_DIR.glob("*.jpg"))
    thumb_size = sum(f.stat().st_size for f in THUMB_DIR.glob("*.jpg"))
    print(f"processed: {done}")
    print(f"docs/photos: {full_size/1024/1024:.1f} MB")
    print(f"docs/photos/thumb: {thumb_size/1024/1024:.1f} MB")


if __name__ == "__main__":
    main()
