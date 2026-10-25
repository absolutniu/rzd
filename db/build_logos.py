# -*- coding: utf-8 -*-
"""
Логотипы заводов: db/sources/logos/{ID}.(svg|png|webp|jpg) -> docs/logos/ под сайт.

- растровые: обрезаются пустые прозрачные поля, уменьшаются до MAX_W x MAX_H и
  сохраняются как PNG (исходники бывают по 3000+ px и под мегабайт);
- SVG копируются как есть;
- для каждого логотипа выбирается подложка: «light» (белая) или «dark» — для
  светлых логотипов на прозрачном фоне (белый текст), которые на белом не видны.
  Для растров подложка определяется автоматически по яркости, для SVG — по
  PLATE_OVERRIDE (по умолчанию light).

Результат: docs/logos/{ID}.png|svg + docs/logos/manifest.json ({ID: {file, plate}}),
который читает export_catalog.py.

Запуск: python build_logos.py  (затем python export_catalog.py)
"""
import json
import shutil
from pathlib import Path

import numpy as np
from PIL import Image

BASE = Path(__file__).parent
SRC = BASE / "sources" / "logos"
OUT = BASE.parent / "docs" / "logos"
MAX_W, MAX_H = 600, 300
PLATE_OVERRIDE = {}  # "M3000": "dark" — если автоматический выбор не подошёл


def plate_for(im):
    """dark — если заметная часть видимых пикселей светлая (белый текст на прозрачном фоне),
    иначе такой логотип пропадает на белом."""
    a = np.asarray(im.convert("RGBA")).astype(float)
    visible = a[..., 3] > 128
    if not visible.any() or visible.mean() > 0.98:
        return "light"  # непрозрачный прямоугольник — у логотипа свой фон
    rgb = a[..., :3][visible]
    lum = 0.299 * rgb[:, 0] + 0.587 * rgb[:, 1] + 0.114 * rgb[:, 2]
    return "dark" if (lum > 215).mean() > 0.35 else "light"


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("*"):
        old.unlink()
    manifest = {}
    for src in sorted(SRC.iterdir()):
        mid, ext = src.stem, src.suffix.lower()
        if ext == ".svg":
            shutil.copyfile(src, OUT / f"{mid}.svg")
            manifest[mid] = {"file": f"logos/{mid}.svg", "plate": PLATE_OVERRIDE.get(mid, "light")}
        elif ext in (".png", ".webp", ".jpg", ".jpeg"):
            im = Image.open(src).convert("RGBA")
            bbox = im.getchannel("A").point(lambda v: 255 if v > 10 else 0).getbbox()
            if bbox:
                im = im.crop(bbox)
            im.thumbnail((MAX_W, MAX_H), Image.LANCZOS)
            im.save(OUT / f"{mid}.png", optimize=True)
            manifest[mid] = {"file": f"logos/{mid}.png", "plate": PLATE_OVERRIDE.get(mid, plate_for(im)),
                             "w": im.width, "h": im.height}
        else:
            continue
        print(f"{mid}: {manifest[mid]['file']} ({manifest[mid]['plate']})")
    (OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"-> {len(manifest)} логотипов в {OUT}")


if __name__ == "__main__":
    main()
