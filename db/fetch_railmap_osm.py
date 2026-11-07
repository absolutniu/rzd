"""Скачивание исходных данных для ж/д карты (docs/railmap/) в db/osm_cache/ (в git не попадает).

  rail_<usage>_<запад>_<восток>.json — пути OSM: way[railway=rail][usage=main|branch], полосами по долготе
  stations.tsv                        — станции и о.п. России (name, esr:user, railway)
  ne10_countries.geojson              — Natural Earth 1:10m, границы стран

Overpass бесплатный и медленный: запросы по одному, с паузами и повторами. Уже скачанное не качается
заново — после сбоя достаточно перезапустить. Затем: python build_railmap.py
"""
import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

CACHE = Path(__file__).parent / "osm_cache"
OVERPASS = "https://overpass-api.de/api/interpreter"
UA = {"User-Agent": "Vagonoteka-railmap/1.0"}
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))  # системный прокси Windows может быть мёртвым
# полосы по долготе: на западе сеть густая — полосы уже
BANDS = [(19, 28), (28, 33), (33, 37), (37, 40), (40, 44), (44, 48), (48, 53), (53, 58), (58, 63), (63, 72),
         (72, 82), (82, 94), (94, 110), (110, 125), (125, 180)]
NE10 = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_admin_0_countries.geojson"


def get(url, data=None, timeout=900):
    req = urllib.request.Request(url, data=urllib.parse.urlencode({"data": data}).encode() if data else None, headers=UA)
    with OPENER.open(req, timeout=timeout) as r:
        return r.read()


def fetch(name, query=None, url=None):
    out = CACHE / name
    if out.exists() and out.stat().st_size > 1000:
        return
    for attempt in range(1, 5):
        try:
            body = get(url) if url else get(OVERPASS, query)
            if query and body.lstrip()[:1] not in (b"{", b"@"):  # Overpass вернул страницу ошибки
                raise RuntimeError(body[:200].decode("utf-8", "replace"))
            out.write_bytes(body)
            print(f"{name}: {len(body) // 1024} КБ", flush=True)
            return
        except Exception as e:  # noqa: BLE001 — сеть/таймаут/перегрузка Overpass: ждём и повторяем
            print(f"{name}: попытка {attempt} не удалась ({str(e)[:120]}), жду", flush=True)
            time.sleep(60 * attempt)
    raise SystemExit(f"{name}: не скачалось")


def main():
    CACHE.mkdir(exist_ok=True)
    fetch("ne10_countries.geojson", url=NE10)
    fetch("stations.tsv", '[out:csv(::type,::id,::lat,::lon,name,"esr:user",railway;true;"\\t")][timeout:600];'
                          'area["ISO3166-1"="RU"][admin_level=2]->.ru;'
                          '(nwr["railway"~"^(station|halt)$"](area.ru););out center;')
    for usage in ("main", "branch"):
        for w, e in BANDS:
            fetch(f"rail_{usage}_{w}_{e}.json",
                  f'[out:json][timeout:600];way["railway"="rail"]["usage"="{usage}"](41,{w},78,{e});out skel geom;')
            time.sleep(5)


if __name__ == "__main__":
    main()
