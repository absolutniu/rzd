"""Ж/д карта: 16 дорог РЖД + Белорусская и Казахстанская; OSM (пути, станции) + наши депо -> docs/railmap/.

Дорога станции — по первым двум цифрам кода ЕСР (таблица проверена на станциях примыкания наших депо);
коды, которых нет в таблице, и станции без кода — по большинству ближайших соседей; Калининградская —
по положению. Дорога отрезка пути — по ближайшей станции. Территория дороги — области ближайших станций
(диаграмма Вороного) по границе России.

Вход — db/osm_cache/ (скачивает fetch_railmap_osm.py). Использование: python build_railmap.py
"""
import csv
import json
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
import shapely
from shapely import STRtree, voronoi_polygons
from shapely.affinity import translate
from shapely.geometry import LineString, MultiPoint, Point, Polygon, box, mapping, shape
from shapely.ops import linemerge, unary_union

BASE = Path(__file__).parent
SRC = BASE / "osm_cache"
OUT = BASE.parent / "docs" / "railmap"
VIEW = (19.0, 41.0, 145.0, 71.0)  # стартовый вид: вся сеть
WORLD = (19.0, 41.0, 191.0, 82.0)  # Чукотка за 180° переносится на +360, чтобы карта не рвалась

# код, название, префиксы кода ЕСР (первые две цифры)
ROADS = {
    "ОКТ": ("Октябрьская", ("01", "03", "04", "05", "07")),
    "КЛГ": ("Калининградская", ()),  # по положению: анклав
    "МСК": ("Московская", ("17", "18", "19", "20", "21", "22", "23")),
    "ГОР": ("Горьковская", ("24", "25", "26", "27")),
    "СЕВ": ("Северная", ("28", "29", "30", "31")),
    "СКВ": ("Северо-Кавказская", ("51", "52", "53")),
    "ЮВС": ("Юго-Восточная", ("43", "58", "59", "60")),
    "ПРВ": ("Приволжская", ("61", "62")),
    "КБШ": ("Куйбышевская", ("63", "64", "65")),
    "СВР": ("Свердловская", ("76", "77", "78", "79")),
    "ЮУР": ("Южно-Уральская", ("80", "81", "82")),
    "ЗСБ": ("Западно-Сибирская", ("83", "84", "85", "86", "87")),
    "КРС": ("Красноярская", ("88", "89")),
    "ВСБ": ("Восточно-Сибирская", ("92", "93")),
    "ЗАБ": ("Забайкальская", ("94", "95")),
    "ДВС": ("Дальневосточная", ("91", "96", "97", "98", "99")),
    "БЧ": ("Белорусская", ()),  # соседние сети — по стране, территория = страна
    "КЗХ": ("Казахстанская", ()),
}
FOREIGN = {"БЧ": ("Belarus", "stations_by.tsv"), "КЗХ": ("Kazakhstan", "stations_kz.tsv")}
ROAD_BY_PREFIX = {p: code for code, (_, prefixes) in ROADS.items() for p in prefixes}
RAILWAY_NAME_TO_CODE = {name: code for code, (name, _) in ROADS.items()}
BAM_JUNCTION_LON = 119.9  # коды БАМа «90…» есть и на ВСЖД, и на ДВЖД: стык Мурурин — Олонгдо
KALININGRAD = box(19.0, 54.2, 23.0, 55.4)
NEIGHBORS = ("Ukraine", "Mongolia", "China", "North Korea", "South Korea", "Japan", "Finland",
             "Estonia", "Latvia", "Lithuania", "Poland", "Norway", "Georgia", "Azerbaijan", "Armenia", "Turkey", "Sweden",
             "Uzbekistan", "Turkmenistan", "Kyrgyzstan", "Iran")


def road_by_code(esr, lon):
    esr = (esr or "").strip()
    if not esr.isdigit():
        return None
    prefix = esr.zfill(6)[:2]
    if prefix == "90":
        return "ДВС" if lon > BAM_JUNCTION_LON else "ВСБ"
    return ROAD_BY_PREFIX.get(prefix)


def write(name, features):
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / name).write_text(json.dumps({"type": "FeatureCollection", "features": features}, ensure_ascii=False,
                                       separators=(",", ":")), encoding="utf-8")
    print(f"{name}: {len(features)} объектов, {(OUT / name).stat().st_size // 1024} КБ", flush=True)


def rounded(geom, nd=4):
    """Координаты до nd знаков (4 ≈ 10 м) — файл в разы меньше."""
    def r(coords):
        return [[round(x, nd), round(y, nd)] for x, y in coords]
    g = mapping(geom)
    t = g["type"]
    if t == "LineString":
        g["coordinates"] = r(g["coordinates"])
    elif t in ("MultiLineString", "Polygon"):
        g["coordinates"] = [r(c) for c in g["coordinates"]]
    elif t == "MultiPolygon":
        g["coordinates"] = [[r(c) for c in poly] for poly in g["coordinates"]]
    return g


def polygons_only(g):
    """После пересечений бывает GeometryCollection с линиями/точками — оставляем площади."""
    if g.geom_type in ("Polygon", "MultiPolygon"):
        return g
    parts = [p for p in getattr(g, "geoms", []) if p.geom_type in ("Polygon", "MultiPolygon")]
    return unary_union(parts) if parts else Polygon()


def unwrap(g):
    """Части западнее 0° (Чукотка за 180°) сдвигаем на +360 — карта непрерывна через 180-й меридиан."""
    parts = g.geoms if g.geom_type == "MultiPolygon" else [g]
    return unary_union([translate(p, 360) if p.bounds[2] <= 0 else p for p in parts])


# ---- граница России и соседи (Natural Earth 1:10m) ----
countries = json.loads((SRC / "ne10_countries.geojson").read_text(encoding="utf-8"))
by_admin = {f["properties"]["ADMIN"]: f for f in countries["features"]}
russia = unwrap(shape(by_admin["Russia"]["geometry"]).buffer(0))
def no_holes(g):  # Байконур вырезан из Казахстана в Natural Earth — на карте дыркой не нужен
    return unary_union([Polygon(p.exterior) for p in (g.geoms if g.geom_type == "MultiPolygon" else [g])])


foreign = {road: no_holes(shape(by_admin[admin]["geometry"]).buffer(0)) for road, (admin, _) in FOREIGN.items()}
land = unary_union([russia, *foreign.values()]).simplify(0.01)
ru_clip = russia.simplify(0.02).buffer(0.03)  # пути вдоль границы не терять
foreign_clip = {road: g.simplify(0.02).buffer(0.03) for road, g in foreign.items()}
clip_area = unary_union([ru_clip, *foreign_clip.values()])
for g in (ru_clip, clip_area, *foreign_clip.values()):
    shapely.prepare(g)

# ---- станции ----
stations, seen = [], set()
with open(SRC / "stations.tsv", encoding="utf-8") as f:
    for r in csv.DictReader(f, delimiter="\t"):
        key = (r["@type"], r["@id"])
        if key in seen or r["railway"] != "station" or not r["name"]:
            continue
        seen.add(key)
        lon, lat = float(r["@lon"]), float(r["@lat"])
        if not ru_clip.contains(Point(lon, lat)):
            continue  # Крым и пр. вне границы Natural Earth — не наша сеть
        road = "КЛГ" if KALININGRAD.contains(Point(lon, lat)) else road_by_code(r["esr:user"], lon)
        stations.append({"lon": lon, "lat": lat, "name": r["name"], "esr": (r["esr:user"] or "").strip(), "road": road,
                         "by_code": road is not None})
for road, (_, fname) in FOREIGN.items():  # Беларусь, Казахстан: дорога = страна
    with open(SRC / fname, encoding="utf-8") as f:
        for r in csv.DictReader(f, delimiter="	"):
            lon, lat = float(r["@lon"]), float(r["@lat"])
            if r["railway"] == "station" and r["name"] and foreign_clip[road].contains(Point(lon, lat)):
                stations.append({"lon": lon, "lat": lat, "name": r["name"], "esr": (r["esr:user"] or "").strip(),
                                 "road": road, "by_code": False})
coded = [s for s in stations if s["by_code"]]
coded_xy = np.array([(c["lon"], c["lat"]) for c in coded])
for s in stations:  # нет кода или код не из таблицы — по большинству 7 ближайших станций с кодом
    if not s["road"]:
        dx = (coded_xy[:, 0] - s["lon"]) * np.cos(np.radians(s["lat"]))
        idx = np.argpartition(dx ** 2 + (coded_xy[:, 1] - s["lat"]) ** 2, 7)[:7]
        s["road"] = Counter(coded[i]["road"] for i in idx).most_common(1)[0][0]
n_ru = sum(1 for s in stations if s["road"] not in FOREIGN)
print(f"станций: {len(stations)} (РЖД {n_ru}: по коду ЕСР {len(coded)}, по соседям {n_ru - len(coded)}; БЧ и КЗХ {len(stations) - n_ru})", flush=True)
all_tree = STRtree([Point(s["lon"], s["lat"]) for s in stations])
ru_stations = [s for s in stations if s["road"] not in FOREIGN]
ru_tree = STRtree([Point(s["lon"], s["lat"]) for s in ru_stations])

# ---- пути ----
by_road_usage = defaultdict(list)
for path in sorted(SRC.glob("rail_*.json")):
    usage = path.stem.split("_")[1]
    for el in json.loads(path.read_text(encoding="utf-8"))["elements"]:
        pts = [(p["lon"], p["lat"]) for p in el.get("geometry", []) if p]
        if len(pts) < 2:
            continue
        line = LineString(pts)
        if not clip_area.intersects(line):
            continue
        if not clip_area.contains(line):
            line = line.intersection(clip_area)
            if line.is_empty or line.geom_type not in ("LineString", "MultiLineString"):
                continue
        mid = line.interpolate(0.5, normalized=True)
        road = next((r for r, g in foreign_clip.items() if g.contains(mid)), None) or ru_stations[ru_tree.nearest(mid)]["road"]
        by_road_usage[(road, usage)].append(line)
lines, track_raw = [], defaultdict(list)  # track_raw — пути дороги без упрощения (для переходов)
for (road, usage), ls in sorted(by_road_usage.items()):
    raw_lines = linemerge(unary_union(ls))
    track_raw[road].append(raw_lines)
    merged = raw_lines.simplify(0.0015 if usage == "main" else 0.002, preserve_topology=False)
    lines.append({"type": "Feature", "properties": {"road": road, "usage": usage}, "geometry": rounded(merged)})
write("lines.geojson", lines)

# ---- территории дорог ----
cells = voronoi_polygons(MultiPoint([(s["lon"], s["lat"]) for s in ru_stations]), extend_to=box(*WORLD))
cell_road = defaultdict(list)
for cell in cells.geoms:
    idx = ru_tree.query(cell, predicate="contains")
    if len(idx):
        cell_road[ru_stations[idx[0]]["road"]].append(cell)
ru_land = russia.simplify(0.01)
areas, labels, area_raw = [], [], {}
for road in ROADS:
    if road in FOREIGN:
        area_raw[road] = foreign[road]
    elif road in cell_road:
        area_raw[road] = polygons_only(unary_union(cell_road[road]).intersection(ru_land))
    else:
        continue
    area = area_raw[road].simplify(0.02).buffer(0)
    if area.is_empty:
        continue
    props = {"road": road, "name": ROADS[road][0]}
    areas.append({"type": "Feature", "properties": props, "geometry": rounded(area, 3)})
    main = max(area.geoms, key=lambda x: x.area) if area.geom_type == "MultiPolygon" else area
    pt = main.point_on_surface()
    labels.append({"type": "Feature", "properties": props, "geometry": {"type": "Point", "coordinates": [round(pt.x, 3), round(pt.y, 3)]}})
write("roads.geojson", areas)
write("road_labels.geojson", labels)

# ---- переходы между дорогами: где пути пересекают границу территорий двух дорог ----
# точка одна, а объекта два (по одному на каждую сторону): при выбранной дороге видны её переходы,
# подпись — соседняя дорога, клик — переход на неё
JUNCTION_GAP = 0.35  # ° (~25–35 км): ближе — один переход
junctions = []
codes = list(area_raw)
for i, a in enumerate(codes):
    for b in codes[i + 1:]:
        strip = area_raw[a].buffer(0.02).intersection(area_raw[b].buffer(0.02))
        if strip.is_empty or strip.area == 0:
            continue
        cross = unary_union(track_raw[a] + track_raw[b]).intersection(strip)
        pts = [g.interpolate(0.5, normalized=True) for g in getattr(cross, "geoms", [cross]) if g.geom_type == "LineString" and not g.is_empty]
        groups = []
        for p in pts:
            g = next((g for g in groups if g[0].distance(p) < JUNCTION_GAP), None)
            if g: g.append(p)
            else: groups.append([p])
        for g in groups:
            c = (round(sum(p.x for p in g) / len(g), 4), round(sum(p.y for p in g) / len(g), 4))
            for here, there in ((a, b), (b, a)):
                junctions.append({"type": "Feature", "properties": {"road": here, "to": there, "to_name": ROADS[there][0]},
                                  "geometry": {"type": "Point", "coordinates": list(c)}})

# стыки из справочника (sources/railmap_stations.xlsx, лист «Соединения ЖД»: станция А — станция Б) заменяют
# вычисленные переходы для своей пары дорог; точка — середина между стыковыми станциями (или та, что нашлась)
JUNCTIONS_XLSX = BASE / "sources" / "railmap_stations.xlsx"
if JUNCTIONS_XLSX.exists():
    import openpyxl
    wb = openpyxl.load_workbook(JUNCTIONS_XLSX, read_only=True, data_only=True)
    known = {str(r[1]).strip(): (r[3], r[2]) for r in wb["0. Справ_Станции + коорд"].iter_rows(min_row=2, values_only=True)
             if r[1] and r[2] and r[3]}
    by_name = defaultdict(list)
    for st in stations:
        by_name[st["name"].strip().lower()].append(st)

    def locate(name, roads):  # сначала справочник, затем OSM — станция одной из двух дорог стыка
        if name in known:
            return known[name]
        cands = [st for st in by_name.get(name.lower(), []) if st["road"] in roads]
        return (cands[0]["lon"], cands[0]["lat"]) if cands else None

    fixed = []
    for r in wb["Соединения ЖД"].iter_rows(min_row=3, values_only=True):
        if not r[0] or not r[1]:
            continue
        a, b = (RAILWAY_NAME_TO_CODE.get(x.strip()) for x in str(r[1]).split(" - "))
        sa, sb = str(r[3]).strip(), str(r[5]).strip()
        pts = [p for p in (locate(sa, {a, b}), locate(sb, {a, b})) if p]
        if not (a and b and pts):
            print(f"стык {r[0]} ({sa} — {sb}): станции не найдены, пропускаю")
            continue
        c = [round(sum(p[0] for p in pts) / len(pts), 4), round(sum(p[1] for p in pts) / len(pts), 4)]
        fixed.append((a, b, c, f"{sa} — {sb}"))
    pairs = {frozenset((a, b)) for a, b, _, _ in fixed}
    junctions = [j for j in junctions if frozenset((j["properties"]["road"], j["properties"]["to"])) not in pairs]
    for a, b, c, title in fixed:
        for here, there in ((a, b), (b, a)):
            junctions.append({"type": "Feature", "properties": {"road": here, "to": there, "to_name": ROADS[there][0], "stations": title},
                              "geometry": {"type": "Point", "coordinates": c}})
    print(f"стыков из справочника: {len(fixed)} (пар дорог: {len(pairs)})")
write("junctions.geojson", junctions)

neighbors = []
for name in NEIGHBORS:
    g = polygons_only(shape(by_admin[name]["geometry"]).buffer(0).intersection(box(5, 30, 191, 82)))
    if not g.is_empty:
        neighbors.append({"type": "Feature", "properties": {"name": by_admin[name]["properties"].get("NAME_RU") or name},
                          "geometry": rounded(g.simplify(0.02), 3)})
write("neighbors.geojson", neighbors)
write("land.geojson", [{"type": "Feature", "properties": {}, "geometry": rounded(land, 3)}])

write("stations.geojson", [
    {"type": "Feature", "properties": {"name": s["name"], "esr": s["esr"], "road": s["road"]},
     "geometry": {"type": "Point", "coordinates": [round(s["lon"], 5), round(s["lat"], 5)]}}
    for s in stations])

# ---- депо из выгрузки сайта ----
cat = json.loads((BASE.parent / "docs" / "data" / "catalog_data.json").read_text(encoding="utf-8"))
rw = {r["id"]: r["name"] for r in cat["railways"]}
hold = {h["id"]: h["short_name"] for h in cat["repairHoldings"]}
dep = []
for d in cat["depots"]:
    road = RAILWAY_NAME_TO_CODE.get(rw.get(d["railway_id"], ""))
    if road and d.get("latitude") and d.get("longitude"):
        dep.append({"type": "Feature", "properties": {"id": d["id"], "name": d["name"], "road": road,
                                                      "holding": hold.get(d["holding_id"], ""), "holding_id": d["holding_id"],
                                                      "icon": d.get("map_icon") or "●"},
                    "geometry": {"type": "Point", "coordinates": [d["longitude"], d["latitude"]]}})
write("depots.geojson", dep)
(OUT / "meta.json").write_text(json.dumps({"roads": {k: v[0] for k, v in ROADS.items()}, "bbox": VIEW,
                                           "holdings": cat["repairHoldings"]}, ensure_ascii=False), encoding="utf-8")
