# -*- coding: utf-8 -*-
"""
Экспортирует ПОЛНУЮ базу rzd.db в JSON-пакет для сайта-каталога (прототипа).
Один вагон -> одна запись specs, независимо от того, в какой из 11 таблиц
характеристик (gondola_char, tank_char, ... dump_car_char) она физически лежит.

Запуск: python export_catalog.py
Результат: catalog_data.json рядом со скриптом.
"""
import json
import sqlite3
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

BASE = Path(__file__).parent
DB_PATH = BASE / "rzd.db"
OUT_PATH = BASE.parent / "docs" / "data" / "catalog_data.json"

# таблица характеристик -> её "тип семейства" (T00x), для приоритета при разборе конфликтов
CHAR_TABLES = {
    "gondola_char": "T001",
    "tank_char": "T002",
    "hopper_char": "T003",
    "universal_platform_char": "T004",
    "fitting_platform_char": "T004",
    "timber_platform_char": "T004",
    "rolled_metal_platform_char": "T004",
    "other_platform_char": "T004",
    "covered_wagon_char": "T005",
    "reefer_char": "T006",
    "dump_car_char": "T007",
}
# порядок предпочтения таблиц внутри T004 при неоднозначности (2 вагона на 256 - крайний случай)
PLATFORM_PRIORITY = ["universal_platform_char", "fitting_platform_char", "timber_platform_char",
                      "rolled_metal_platform_char", "other_platform_char"]


def main():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    def rows(sql, params=()):
        cur.execute(sql, params)
        return [dict(r) for r in cur.fetchall()]

    def clean_specs(d):
        return {k: v for k, v in d.items() if k != "vagon_id" and v is not None}

    # ---- характеристики: по каждому вагону подобрать нужную таблицу ----
    specs_by_vagon = {}
    for table, type_id in CHAR_TABLES.items():
        for r in rows(f"SELECT * FROM {table}"):
            vid = r["vagon_id"]
            candidate = (table, clean_specs(r))
            if vid not in specs_by_vagon:
                specs_by_vagon[vid] = candidate
                continue
            # конфликт: уже есть запись для этого вагона из другой таблицы
            prev_table, prev_specs = specs_by_vagon[vid]
            cur.execute("SELECT vagon_type_id FROM vagons WHERE id=?", (vid,))
            vtype = cur.fetchone()[0]
            prev_matches = CHAR_TABLES[prev_table] == vtype
            new_matches = type_id == vtype
            if new_matches and not prev_matches:
                specs_by_vagon[vid] = candidate
            elif new_matches == prev_matches:
                # оба (не)совпадают по типу - берём более полную запись,
                # при равенстве - по PLATFORM_PRIORITY
                if len(candidate[1]) > len(prev_specs):
                    specs_by_vagon[vid] = candidate
                elif len(candidate[1]) == len(prev_specs) and table in PLATFORM_PRIORITY and prev_table in PLATFORM_PRIORITY:
                    if PLATFORM_PRIORITY.index(table) < PLATFORM_PRIORITY.index(prev_table):
                        specs_by_vagon[vid] = candidate

    # ---- справочники ----
    vagon_types = rows("SELECT id, name FROM vagon_types")
    vagon_kinds = rows("SELECT id, vagon_type_id, name FROM vagon_kinds")
    railways = rows("SELECT id, name FROM railways")
    repair_types = rows("SELECT id, name FROM repair_types")
    repair_holdings = rows("SELECT id, full_name, short_name, country, enterprise_type, website, telegram FROM repair_holdings")
    features = rows("SELECT id, name FROM vagon_features")
    container_sizes = rows("SELECT id, name FROM container_sizes")

    manufacturers = rows("""
        SELECT id, parent_id, full_name, short_name, country, region, city, enterprise_type,
               produces_25tf_vagons, website, telegram_1, telegram_2, telegram_3
        FROM manufacturers
    """)
    mfr_cap = {r["manufacturer_id"]: r for r in rows("SELECT * FROM manufacturer_capacity")}
    mfr_types = {}
    for r in rows("""SELECT mvt.manufacturer_id, vt.name FROM manufacturer_vagon_types mvt
                      JOIN vagon_types vt ON vt.id = mvt.vagon_type_id"""):
        mfr_types.setdefault(r["manufacturer_id"], []).append(r["name"])
    for m in manufacturers:
        cap = mfr_cap.get(m["id"])
        m["capacity"] = cap["capacity_thousand_vagons_year"] if cap else None
        m["staff"] = cap["staff_thousand"] if cap else None
        m["capYear"] = cap["data_year"] if cap else None
        m["vagonTypes"] = mfr_types.get(m["id"], [])

    bogies = rows("SELECT id, model, model_note, manufacturer_id, axle_load_tf, axle_load_kn FROM bogies")
    vagon_bogie = {}
    for r in rows("SELECT vagon_id, bogie_id FROM vagon_bogies"):
        vagon_bogie.setdefault(r["vagon_id"], []).append(r["bogie_id"])

    depots = rows("""
        SELECT id, holding_id, name, stamp_code, railway_id, adjoining_station, station_code,
               latitude, longitude, website
        FROM depots
    """)
    depot_competencies = rows("SELECT depot_id, repair_type_id, vagon_type_id, vagon_kind_id, note FROM depot_competencies")
    depot_authorizations = rows("SELECT depot_id, repair_type_id, vagon_id FROM depot_authorizations")

    feature_links = {}
    for r in rows("SELECT vagon_id, feature_id FROM vagon_feature_links"):
        feature_links.setdefault(r["vagon_id"], []).append(r["feature_id"])

    certs = {}
    for r in rows("SELECT vagon_id, id, cert_number, valid_from, valid_to, status FROM certificates"):
        certs[r["vagon_id"]] = {"id": r["id"], "number": r["cert_number"], "from": r["valid_from"],
                                 "to": r["valid_to"], "status": r["status"]}

    overhaul = {}
    for r in rows("""SELECT vagon_id, criterion, dr_after_build_years, dr_after_build_km_thousand,
                             dr_after_dr_years, dr_after_dr_km_thousand, dr_after_kr_years,
                             dr_after_kr_km_thousand, kr_after_build_years, kr_after_kr_years
                      FROM vagon_overhaul_intervals ORDER BY vagon_id, id"""):
        overhaul.setdefault(r["vagon_id"], []).append({
            "c": r["criterion"], "drBuild": r["dr_after_build_years"], "drBuildKm": r["dr_after_build_km_thousand"],
            "drDr": r["dr_after_dr_years"], "drDrKm": r["dr_after_dr_km_thousand"],
            "drKr": r["dr_after_kr_years"], "drKrKm": r["dr_after_kr_km_thousand"],
            "krBuild": r["kr_after_build_years"], "krKr": r["kr_after_kr_years"],
        })

    platform_containers = {}
    for r in rows("SELECT vagon_id, container_size_id FROM platform_containers"):
        platform_containers.setdefault(r["vagon_id"], []).append(r["container_size_id"])

    cargo_types = rows("SELECT id, name, etsng_code FROM cargo_types")
    vagon_cargo = [[r["vagon_id"], r["cargo_id"]] for r in rows("SELECT vagon_id, cargo_id FROM vagon_cargo")]

    # ---- вагоны ----
    vagons = []
    for v in rows("""
        SELECT id, vagon_type_id, vagon_kind_id, model, model_note, manufacturer_id, kd_number,
               accounting_specialization, europallet_count, requires_authorization
        FROM vagons ORDER BY id
    """):
        table, specs = specs_by_vagon.get(v["id"], (None, {}))
        bogie_ids = vagon_bogie.get(v["id"], [])
        vagons.append({
            "id": v["id"],
            "typeId": v["vagon_type_id"],
            "kindId": v["vagon_kind_id"],
            "model": v["model"],
            "modelNote": v["model_note"],
            "mfrId": v["manufacturer_id"],
            "kdNumber": v["kd_number"],
            "specialization": v["accounting_specialization"],
            "europallets": v["europallet_count"],
            "requiresAuth": v["requires_authorization"] == "да",
            "specs": specs,
            "bogieId": bogie_ids[0] if bogie_ids else None,
            "featureIds": feature_links.get(v["id"], []),
            "cert": certs.get(v["id"]),
            "overhaul": overhaul.get(v["id"], []),
            "cargoIds": None,  # заполним ниже из vagon_cargo (экономим место, не дублируем)
            "containerIds": platform_containers.get(v["id"]),
        })

    vagon_cargo_map = {}
    for vid, cid in vagon_cargo:
        vagon_cargo_map.setdefault(vid, []).append(cid)
    for v in vagons:
        v["cargoIds"] = vagon_cargo_map.get(v["id"], [])

    bundle = {
        "vagonTypes": vagon_types,
        "vagonKinds": vagon_kinds,
        "manufacturers": manufacturers,
        "bogies": bogies,
        "depots": depots,
        "railways": railways,
        "repairTypes": repair_types,
        "repairHoldings": repair_holdings,
        "depotCompetencies": depot_competencies,
        "depotAuthorizations": depot_authorizations,
        "features": features,
        "containerSizes": container_sizes,
        "cargoTypes": cargo_types,
        "vagonCargoLinks": vagon_cargo,
        "vagons": vagons,
    }

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(bundle, f, ensure_ascii=False, separators=(",", ":"))

    size_kb = OUT_PATH.stat().st_size / 1024
    print(f"vagons: {len(vagons)}")
    print(f"manufacturers: {len(manufacturers)}")
    print(f"depots: {len(depots)}")
    print(f"cargoTypes: {len(cargo_types)}, vagonCargoLinks: {len(vagon_cargo)}")
    print(f"depotCompetencies: {len(depot_competencies)}, depotAuthorizations: {len(depot_authorizations)}")
    print(f"-> {OUT_PATH}  ({size_kb:.0f} KB)")


if __name__ == "__main__":
    main()
