"""Референсы для постеров: один вагон на пару «тип вагона × предприятие» -> exports/posters_refs/.

Не каждую модель, а уникальные сочетания: у предприятия общая ливрея, у типа — общий силуэт. Филиалы и
дочерние заводы (Рубцовский филиал, Тихвинский ВСЗ…) — в группе головной компании. «Прочие» (особые
вагоны) — по модели: силуэты у них разные.

Фото — исходник из docs/Photo (крупнее), иначе фото сайта docs/photos; из группы берётся самое «вытянутое»
(ближе к виду сбоку) или выбранное вручную в build_posters.py (REP_OVERRIDE).

Запуск: python export_poster_refs.py
Результат: exports/posters_refs/NN_Тип_Предприятие_модель.jpg, список.csv (Excel), README.txt
"""
import csv
import json
import shutil
from collections import defaultdict
from pathlib import Path

from PIL import Image

BASE = Path(__file__).parent
ROOT = BASE.parent
OUT = ROOT / "exports" / "posters_refs"
cat = json.loads((ROOT / "docs" / "data" / "catalog_data.json").read_text(encoding="utf-8"))
match = json.loads((BASE / "photo_match_results.json").read_text(encoding="utf-8"))["matched"]
old = {m["sourceVagonId"]: m for m in json.loads((ROOT / "docs" / "Posters" / "manifest.json").read_text(encoding="utf-8"))}

TYPE_NAME = {"T001": "Полувагон", "T002": "Цистерна", "T003": "Хоппер", "T004": "Платформа", "T005": "Крытый",
             "T006": "Изотермический", "T007": "Думпкар", "T008": "Особый"}
REP_OVERRIDE = {"Полувагоны БВРЗ 12-9780-01.jpg", "Полувагоны ОВК 12-6745.jpg"}  # из build_posters.py

mfr = {m["id"]: m for m in cat["manufacturers"]}
kinds = {k["id"]: k["name"] for k in cat["vagonKinds"]}
raw_by_vagon = defaultdict(list)
for r in match:
    if (ROOT / "docs" / "Photo" / r["file"]).exists():
        raw_by_vagon[r["vagonId"]].append(ROOT / "docs" / "Photo" / r["file"])


def head(mid):
    m = mfr[mid]
    while m.get("parent_id") and m["parent_id"] in mfr:
        m = mfr[m["parent_id"]]
    return m


def name(m):
    return m.get("short_name") or m.get("name") or m["full_name"]


def photos(v):
    out = list(raw_by_vagon.get(v["id"], []))
    if v.get("photo") and (ROOT / "docs" / v["photo"]).exists():
        out.append(ROOT / "docs" / v["photo"])
    return out


def aspect(p):
    with Image.open(p) as im:
        return im.width / im.height, im.width


groups = defaultdict(list)
for v in cat["vagons"]:
    h = head(v["mfrId"])
    key = (v["typeId"], h["id"], v["model"] if v["typeId"] == "T008" else "")
    groups[key].append(v)

OUT.mkdir(parents=True, exist_ok=True)
for f in OUT.glob("*.jpg"):
    f.unlink()
rows, n = [], 0
order = list(TYPE_NAME)
for (tid, hid, model_key), vs in sorted(groups.items(), key=lambda kv: (order.index(kv[0][0]), name(mfr[kv[0][1]]), kv[0][2])):
    cands = [(p, v) for v in vs for p in photos(v)]
    pick = next(((p, v) for p, v in cands if p.name in REP_OVERRIDE), None)
    if not pick and cands:
        pick = max(cands, key=lambda pv: (aspect(pv[0])[0] > 2.2, pv[0].parent.name == "Photo", aspect(pv[0])[0], aspect(pv[0])[1]))
    company = name(mfr[hid])
    branches = sorted({name(mfr[v["mfrId"]]) for v in vs if v["mfrId"] != hid})
    models = sorted(v["model"] for v in vs)
    row = {"№": "", "Тип": TYPE_NAME[tid], "Предприятие": company, "Филиалы в группе": ", ".join(branches),
           "Модель на фото": "", "Род вагона": "", "Моделей в группе": len(vs), "Все модели": ", ".join(models),
           "Файл": "", "Ливрея (из прежних постеров)": ""}
    if pick:
        n += 1
        p, v = pick
        safe = lambda s: "".join(c if c.isalnum() or c in "-." else "_" for c in s).strip("_")
        fname = f"{n:02d}_{safe(TYPE_NAME[tid])}_{safe(company)}_{safe(v['model'])}{p.suffix.lower()}"
        shutil.copy2(p, OUT / fname)
        o = old.get(v["id"]) or next((old[x["id"]] for x in vs if x["id"] in old), None)
        row.update({"№": n, "Модель на фото": v["model"], "Род вагона": kinds.get(v.get("kindId"), ""), "Файл": fname,
                    "Ливрея (из прежних постеров)": " / ".join(f"{k} {c}" for k, c in o["palette"].items()) if o else ""})
    else:
        row["Файл"] = "нет фото"
    rows.append(row)

with open(OUT / "список.csv", "w", encoding="utf-8-sig", newline="") as f:  # BOM — Excel откроет кириллицу
    w = csv.DictWriter(f, fieldnames=list(rows[0]), delimiter=";")
    w.writeheader()
    w.writerows(rows)
no_photo = [r for r in rows if r["Файл"] == "нет фото"]
(OUT / "README.txt").write_text(
    f"Уникальные вагоны для постеров: тип вагона × предприятие ({len(rows)} сочетаний, с фото {n}).\n"
    "Одна картинка на сочетание: у предприятия общая ливрея (цвета, полосы), у типа — общий силуэт.\n"
    "Филиалы и дочерние заводы — в группе головной компании. Особые вагоны — по модели (силуэты разные).\n"
    "Имя файла: №_Тип_Предприятие_модель. Подробности по каждому — список.csv (открывается в Excel).\n"
    + (("\nБез фото (" + str(len(no_photo)) + "):\n" + "\n".join(f"  {r['Тип']} — {r['Предприятие']}: {r['Все модели']}" for r in no_photo) + "\n")
       if no_photo else ""),
    encoding="utf-8")
print(f"сочетаний {len(rows)}, с фото {n}, без фото {len(no_photo)} -> {OUT}")

# ---- остальные модели: фото вагонов, у которых своего постера нет (в постер группы попала другая модель) ----
# -> exports/photos_without_poster/NN_Тип_Предприятие_модель.jpg, нумерация продолжает референсы (55, 56…)
REST = ROOT / "exports" / "photos_without_poster"
REST.mkdir(parents=True, exist_ok=True)
for f in REST.glob("*.jpg"):
    f.unlink()
on_poster = {r["Модель на фото"] + "|" + r["Тип"] + "|" + r["Предприятие"] for r in rows if r["№"]}
num_by_group = {(r["Тип"], r["Предприятие"], m.strip()): r["№"] for r in rows for m in r["Все модели"].split(",")}
rest_rows, k, no_photo_models = [], n, []
for v in sorted(cat["vagons"], key=lambda v: (order.index(v["typeId"]), name(head(v["mfrId"])), v["model"])):
    company = name(head(v["mfrId"]))
    if f"{v['model']}|{TYPE_NAME[v['typeId']]}|{company}" in on_poster:
        continue
    ph = photos(v)
    if not ph:
        no_photo_models.append(f"{TYPE_NAME[v['typeId']]} — {company}: {v['model']} ({v['id']})")
        continue
    p = max(ph, key=lambda q: (aspect(q)[0] > 2.2, q.parent.name == "Photo", aspect(q)[0], aspect(q)[1]))
    k += 1
    safe = lambda s: "".join(c if c.isalnum() or c in "-." else "_" for c in s).strip("_")
    fname = f"{k:03d}_{safe(TYPE_NAME[v['typeId']])}_{safe(company)}_{safe(v['model'])}{p.suffix.lower()}"
    shutil.copy2(p, REST / fname)
    rest_rows.append({"№": k, "id вагона": v["id"], "Тип": TYPE_NAME[v["typeId"]], "Род вагона": kinds.get(v.get("kindId"), ""),
                      "Предприятие": company, "Завод": name(mfr[v["mfrId"]]), "Модель": v["model"],
                      "Сейчас на сайте рисунок №": num_by_group.get((TYPE_NAME[v["typeId"]], company, v["model"]), ""),
                      "Файл": fname})
with open(REST / "список.csv", "w", encoding="utf-8-sig", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(rest_rows[0]), delimiter=";")
    w.writeheader()
    w.writerows(rest_rows)
readme = [f"Фото моделей, у которых нет своего постера: {len(rest_rows)} (постеры 01–{n:02d} — по одной модели на «тип × предприятие»).",
          f"Номера продолжают референсы: {n + 1:03d}–{k:03d}. Имя файла: №_Тип_Предприятие_модель; id вагона и рисунок, который",
          "сейчас стоит на сайте вместо фото, — в список.csv. Готовые постеры назовите так же (poster_055.png …)."]
if no_photo_models:
    readme += ["", f"Без фото вообще ({len(no_photo_models)}):"] + ["  " + m for m in no_photo_models]
(REST / "README.txt").write_text("\n".join(readme) + "\n", encoding="utf-8")
print(f"без своего постера: {len(rest_rows)} фото, без фото {len(no_photo_models)} -> {REST}")
