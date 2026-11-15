"""Рисунки вагонов для сайта: вырезанные «журнальные» иллюстрации (тип × предприятие) -> docs/illustrations/.

Вход: exports/editorial_posters/cutout/NN_Тип_Предприятие_модель.png (cutout_posters.py) и
exports/posters_refs/список.csv (export_poster_refs.py: какие модели входят в группу NN).
Выход: docs/illustrations/{NN}.webp (до 1000px), thumb/{NN}.webp (420px), manifest.json {id вагона: файлы}.
export_catalog.py добавляет вагонам поля illustration / illustrationThumb; что показывать на сайте —
рисунок или фото — переключатель WAGON_PICS в docs/js/core.js.

Запуск: python build_illustrations.py, затем python export_catalog.py
"""
import csv
import json
from pathlib import Path

from PIL import Image

BASE = Path(__file__).parent
ROOT = BASE.parent
CUT = ROOT / "exports" / "editorial_posters" / "cutout"
LIST = ROOT / "exports" / "posters_refs" / "список.csv"
OUT = ROOT / "docs" / "illustrations"
TYPE_ID = {"Полувагон": "T001", "Цистерна": "T002", "Хоппер": "T003", "Платформа": "T004", "Крытый": "T005",
           "Изотермический": "T006", "Думпкар": "T007", "Особый": "T008"}

cat = json.loads((ROOT / "docs" / "data" / "catalog_data.json").read_text(encoding="utf-8"))
mfr = {m["id"]: m for m in cat["manufacturers"]}


def head(mid):
    m = mfr[mid]
    while m.get("parent_id") and m["parent_id"] in mfr:
        m = mfr[m["parent_id"]]
    return m


def name(m):  # как в export_poster_refs.py
    return m.get("short_name") or m.get("name") or m["full_name"]


cut = {p.name[:2]: p for p in CUT.glob("*.png")}
(OUT / "thumb").mkdir(parents=True, exist_ok=True)
manifest, used = {}, 0
with open(LIST, encoding="utf-8-sig") as f:
    for row in csv.DictReader(f, delimiter=";"):
        if not row["№"]:
            continue
        num = f"{int(row['№']):02d}"
        if num not in cut:
            print(f"{num}: нет вырезки, пропускаю")
            continue
        im = Image.open(cut[num]).convert("RGBA")
        for size, path in ((1000, OUT / f"{num}.webp"), (420, OUT / "thumb" / f"{num}.webp")):
            k = min(1, size / im.width)
            im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS).save(path, "WEBP", quality=86, method=6)
        models = {m.strip() for m in row["Все модели"].split(",")}
        tid = TYPE_ID[row["Тип"]]
        hits = [v["id"] for v in cat["vagons"]
                if v["typeId"] == tid and v["model"] in models and name(head(v["mfrId"])) == row["Предприятие"]]
        for vid in hits:
            manifest[vid] = {"src": f"illustrations/{num}.webp", "thumb": f"illustrations/thumb/{num}.webp"}
        used += 1
        if len(hits) != int(row["Моделей в группе"]):
            print(f"{num}: вагонов {len(hits)}, в списке {row['Моделей в группе']}")
(OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=0), encoding="utf-8")
print(f"рисунков {used}, вагонов с рисунком {len(manifest)} из {len(cat['vagons'])} -> {OUT}")
