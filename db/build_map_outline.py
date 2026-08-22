# -*- coding: utf-8 -*-
"""
Готовит контур РФ для подложки карты депо (docs/index.html, RUSSIA_OUTLINE).

Источник: johan/world.geo.json (упрощённая Natural Earth 110m), контур России
целиком (материк + острова/эксклавы). Обрезаем по геограницам карты депо и
прореживаем Douglas-Peucker, чтобы получить компактный набор точек для
декоративной SVG-подложки (не для точной картографии).

Требует: shapely (pip install shapely).
Запуск: python build_map_outline.py
Результат печатается в stdout как JS-литерал — вставить вместо RUSSIA_OUTLINE
в docs/index.html (константа объявлена прямо над buildDepotMap()).

Геограницы (LON_MIN/MAX, LAT_MIN/MAX) и параметры xOf/yOf в buildDepotMap()
завязаны на эти же значения — если меняете одно, меняйте и другое.
"""
import json
import subprocess
import sys
from pathlib import Path

from shapely.geometry import shape, box

RAW_URL = "https://raw.githubusercontent.com/johan/world.geo.json/master/countries/RUS.geo.json"
LON_MIN, LON_MAX = 18, 146
LAT_MIN, LAT_MAX = 40, 74
SIMPLIFY_TOLERANCE = 0.15  # градусы


def main():
    raw_path = Path(__file__).parent / "sources" / "russia_boundary_110m.geojson"
    if not raw_path.exists():
        subprocess.run(["curl", "-s", "--max-time", "20", "-o", str(raw_path), RAW_URL], check=True)

    data = json.load(open(raw_path, encoding="utf-8"))
    geom = shape(data["features"][0]["geometry"])
    clipped = geom.intersection(box(LON_MIN, LAT_MIN, LON_MAX, LAT_MAX))
    simplified = clipped.simplify(SIMPLIFY_TOLERANCE, preserve_topology=True)

    polys = list(simplified.geoms) if simplified.geom_type == "MultiPolygon" else [simplified]
    polys.sort(key=lambda p: -p.area)

    rings = []
    for p in polys:
        coords = list(p.exterior.coords)
        if coords[0] == coords[-1]:
            coords = coords[:-1]
        ring = []
        for lon, lat in coords:
            ring.append(round(lon, 2))
            ring.append(round(lat, 2))
        rings.append(ring)

    out = json.dumps(rings, separators=(",", ":"))
    print(out)
    print(f"-> {len(rings)} колец, {sum(len(r)//2 for r in rings)} точек, {len(out)} байт", file=sys.stderr)


if __name__ == "__main__":
    main()
