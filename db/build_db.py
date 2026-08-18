# -*- coding: utf-8 -*-
"""
Парсит D:\\Projects\\claude\\RZD\\RZD.md (markdown-таблицы, экспорт из Excel) плюс
sources/prilozhenie_e_telezhki.md (Прил.Е РД 32 ЦВ 052-2009 про чертежи тележек тип 2
по ГОСТ 9246 при производстве/ремонте) и загружает всё в SQLite по схеме schema.sql.

Запуск:  python build_db.py
Результат: D:\\Projects\\claude\\RZD\\db\\rzd.db
"""
import re
import sqlite3
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

BASE = Path(__file__).parent
MD_PATH = BASE.parent / "RZD.md"
SCHEMA_PATH = BASE / "schema.sql"
DB_PATH = BASE / "rzd.db"
PRILOZHENIE_E_PATH = BASE / "sources" / "prilozhenie_e_telezhki.md"

# Заголовки блоков Прил.Е -> component_types.id ("BOGIE" - особый случай, весь чертёж
# тележки в сборе, идёт в bogie_drawings, а не в component_repair_drawings)
PRILOZHENIE_E_COMPONENT_MAP = [
    ("Чертеж тележки", "BOGIE"),
    ("боковой рамы", "Z002"),
    ("надрессорной балки", "Z003"),
    ("триангеля", "Z006"),
    ("Колесная пара", "Z001"),
    ("Пружина наружная", "Z004"),
    ("Пружина внутренняя", "Z005"),
]
# уверенные сопоставления сокращённого завода из РД с нашим справочником manufacturers;
# остальные сокращения ("Промтрактор", "КВСЗ", "ГСКБВ", "Казахстан" и т.п.) неоднозначны
# или это предприятия вне нашего справочника - оставляем как сырой текст без FK
PRILOZHENIE_E_KNOWN_MANUFACTURERS = {"ТВСЗ": "M710"}


# ---------------------------------------------------------------------------
# Парсинг markdown-таблиц
# ---------------------------------------------------------------------------

def parse_sections(text):
    """Возвращает {имя_раздела: (header_list, [row_dict, ...])}"""
    sections = {}
    parts = re.split(r"(?m)^## ", text)
    for part in parts[1:]:
        lines = part.split("\n")
        name = lines[0].strip()
        header = None
        rows = []
        for line in lines[1:]:
            line = line.rstrip("\r")
            stripped = line.strip()
            if not stripped.startswith("|"):
                continue
            cells = [c.strip() for c in stripped.strip("|").split("|")]
            if header is None:
                header = cells
                continue
            if all(set(c) <= {"-"} and c != "" for c in cells):
                continue  # разделительная строка "| --- | --- |"
            rows.append(dict(zip(header, cells)))
        sections[name] = (header, rows)
    return sections


# ---------------------------------------------------------------------------
# Коэрсия значений
# ---------------------------------------------------------------------------

def c(v):
    """clean: пустая строка / NaN / NaT -> None"""
    if v is None:
        return None
    v = v.strip()
    if v in ("", "NaN", "NaT", "nan", "None"):
        return None
    return v


def f(v):
    v = c(v)
    return float(v) if v is not None else None


def code(v):
    """строковый код, пришедший из Excel как float ("503056.0" -> "503056")"""
    v = c(v)
    if v is None:
        return None
    if v.endswith(".0"):
        v = v[:-2]
    return v


def i(v):
    v = c(v)
    if v is None:
        return None
    return int(round(float(v)))


def d(v):
    v = c(v)
    return v[:10] if v is not None else None


def parse_prilozhenie_e_table(path):
    """Разбирает markdown-таблицу Прил.Е (одна большая pandas-экспортная таблица,
    не набор ## Sheet-секций как в RZD.md) в список строк-списков ячеек."""
    lines = [ln.rstrip("\n") for ln in path.read_text(encoding="utf-8").splitlines()
             if ln.strip().startswith("|")]
    rows = []
    for ln in lines:
        cells = [c(cell.strip()) for cell in ln.strip().strip("|").split("|")]
        if all(cell is None or set(cell) <= {"-"} for cell in cells):
            continue  # разделительная строка "| --- | --- |"
        rows.append(cells)
    return rows


def load_prilozhenie_e(conn, cur):
    """Прил.Е (обязательное) РД 32 ЦВ 052-2009 "Ремонт тележек грузовых вагонов тип 2
    по ГОСТ 9246 с боковыми скользунами зазорного типа" - см. sources/prilozhenie_e_telezhki.md.
    Даёт по каждому из 6 типов компонентов: чертежи ПРИ ПРОИЗВОДСТВЕ (по модели тележки,
    -> bogie_components) и чертежи, ДОПУСТИМЫЕ ПРИ РЕМОНТЕ (общие для типа компонента,
    не привязаны к модели -> component_repair_drawings), плюс чертежи тележки в сборе
    (-> bogie_drawings)."""
    if not PRILOZHENIE_E_PATH.exists():
        print("Прил.Е РД 32 ЦВ 052-2009: файл-источник не найден, пропускаю")
        return

    rows = parse_prilozhenie_e_table(PRILOZHENIE_E_PATH)
    # rows[0] = заголовок (не используется), rows[1] = модели тележек, rows[2] = заводы,
    # rows[3] = номера столбцов 1..21 (не используется), rows[4:] = данные
    models = rows[1][1:20]
    mfr_labels = rows[2][1:20]
    data_rows = rows[4:]

    cur.execute("SELECT id, model FROM bogies")
    bogie_by_model = {model: bid for bid, model in cur.fetchall()}
    existing_nums = [int(bid[1:]) for bid in bogie_by_model.values() if bid[1:].isdigit()]
    next_bogie_num = max(existing_nums, default=0) + 1

    model_to_bogie = {}
    new_bogies = 0
    for model, mfr_label in zip(models, mfr_labels):
        bid = bogie_by_model.get(model)
        if bid:
            cur.execute("UPDATE bogies SET rd9246_manufacturer_label=? WHERE id=?", (mfr_label, bid))
        else:
            bid = f"B{next_bogie_num:03d}"
            next_bogie_num += 1
            new_bogies += 1
            mfr_id = PRILOZHENIE_E_KNOWN_MANUFACTURERS.get(mfr_label)
            cur.execute("""INSERT INTO bogies (id, model, manufacturer_id, rd9246_manufacturer_label)
                           VALUES (?, ?, ?, ?)""", (bid, model, mfr_id, mfr_label))
        model_to_bogie[model] = bid

    # источник авторитетен для этих 19 моделей - убираем более ранние частичные записи
    # (в т.ч. исходный ручной сэмпл для B001 из "Тележ-Комплект"/"Тележка-чертеж"), чтобы
    # при повторной сборке не задваивалось
    covered_ids = list(model_to_bogie.values())
    qs = ",".join("?" * len(covered_ids))
    cur.execute(f"DELETE FROM bogie_components WHERE bogie_id IN ({qs})", covered_ids)
    cur.execute(f"DELETE FROM bogie_drawings WHERE bogie_id IN ({qs})", covered_ids)
    cur.execute(f"DELETE FROM component_repair_drawings WHERE 1=1")  # источник один на всю таблицу

    x_num = 1
    bogie_drawing_n = 0
    production_n = 0
    repair_n = 0
    repair_sort = {}  # component_type_id -> следующий sort_order
    prod_sort = {}    # (bogie_id, component_type_id) -> следующий sort_order
    component = None
    for row in data_rows:
        label = row[0]
        if label:
            match = next((ct for kw, ct in PRILOZHENIE_E_COMPONENT_MAP if kw.lower() in label.lower()), None)
            component = match  # None, если строка-заголовок не распознана - блок пропускаем
            if match is None:
                continue
        if component is None:
            continue

        values = row[1:20]
        repair_val = row[20] if len(row) > 20 else None

        if component == "BOGIE":
            for model, val in zip(models, values):
                if val:
                    bid = model_to_bogie[model]
                    cur.execute("INSERT INTO bogie_drawings (bogie_id, drawing_number) VALUES (?, ?)", (bid, val))
                    bogie_drawing_n += 1
            continue

        for model, val in zip(models, values):
            if not val:
                continue
            bid = model_to_bogie[model]
            key = (bid, component)
            order = prod_sort.get(key, 0)
            prod_sort[key] = order + 1
            xid = f"X{x_num:03d}"
            x_num += 1
            cur.execute("""INSERT INTO bogie_components (id, bogie_id, component_type_id, drawing_number, sort_order)
                           VALUES (?, ?, ?, ?, ?)""", (xid, bid, component, val, order))
            production_n += 1

        if repair_val:
            order = repair_sort.get(component, 0)
            repair_sort[component] = order + 1
            cur.execute("""INSERT INTO component_repair_drawings (component_type_id, drawing_number, sort_order)
                           VALUES (?, ?, ?)""", (component, repair_val, order))
            repair_n += 1

    print(f"  Прил.Е РД 32 ЦВ 052-2009            -> {len(models):3d} моделей тележек "
          f"({new_bogies} новых), {production_n:4d} чертежей произв., "
          f"{repair_n:4d} чертежей ремонт., {bogie_drawing_n} чертежей тележки в сборе")


# ---------------------------------------------------------------------------
# Загрузка
# ---------------------------------------------------------------------------

def main():
    text = MD_PATH.read_text(encoding="utf-8")
    sec = parse_sections(text)

    if DB_PATH.exists():
        DB_PATH.unlink()
    conn = sqlite3.connect(DB_PATH)
    conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
    conn.execute("PRAGMA foreign_keys = OFF")  # включим и проверим после загрузки
    cur = conn.cursor()

    def rows(name):
        return sec[name][1]

    def load(name, sql, mapper, skip_if=None):
        data = []
        for r in rows(name):
            if skip_if and skip_if(r):
                continue
            data.append(mapper(r))
        if data:
            cur.executemany(sql, data)
        print(f"  {name:32s} -> {len(data):6d} строк")

    print("Справочники вагонов:")
    load("Типы_вагонов",
         "INSERT INTO vagon_types (id, name) VALUES (?, ?)",
         lambda r: (r["ID тип"], r["Тип вагона"]))

    load("Род_вагонов",
         "INSERT INTO vagon_kinds (id, vagon_type_id, name) VALUES (?, ?, ?)",
         lambda r: (r["ID род"], r["ID тип"], r["Род вагона"]))

    load("Размеры_контейнеров",
         "INSERT INTO container_sizes (id, name) VALUES (?, ?)",
         lambda r: (r["ID тип контейнер"], r["Типоразмер контейнера"]))

    print("Вагоностроительные заводы:")
    load("ВСЗ_Подраздел конт",
         "INSERT INTO manufacturer_departments (id, name, sort_order) VALUES (?, ?, ?)",
         lambda r: (r["ID подразделения"], r["Наименование"], i(r["Порядок показа"])))

    load("ID вагоностр. произ",
         """INSERT INTO manufacturers
            (id, full_name, short_name, country, region, city, enterprise_type,
             produces_25tf_vagons, website, telegram_1, telegram_2, telegram_3)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
         lambda r: (r["ID предприятия"], r["Наименование"], c(r["Краткое наименование"]),
                    c(r["Страна"]), c(r["Регион"]), c(r["Город"]), c(r["Тип предприятия"]),
                    c(r["Компетенции по производству вагонов 25 тс"]), c(r["Сайт"]),
                    c(r["Канал Телеграм 1"]), c(r["Канал Телеграм 2"]), c(r["Канал Телеграм 3"])))

    for r in rows("ВСЗ_Структур"):
        cur.execute("UPDATE manufacturers SET parent_id = ? WHERE id = ?",
                    (r["ID предприятия"], r["ID заводов"]))
    print(f"  {'ВСЗ_Структур (parent_id)':32s} -> {len(rows('ВСЗ_Структур')):6d} строк")

    load("ВСЗ_Типы ваг",
         "INSERT INTO manufacturer_vagon_types (manufacturer_id, vagon_type_id) VALUES (?, ?)",
         lambda r: (r["ID предприятия"], r["ID тип"]))

    load("ВСЗ_Показат",
         """INSERT INTO manufacturer_capacity
            (manufacturer_id, capacity_thousand_vagons_year, staff_thousand, data_year)
            VALUES (?, ?, ?, ?)""",
         lambda r: (r["ID предприятия"], f(r["Производственные мощности, тысяч вагонов в год"]),
                    f(r["Численность персонала, тысяч человек"]), i(r["Год актуальности"])))

    load("ВСЗ_Выпуск",
         """INSERT INTO manufacturer_output (manufacturer_id, year, volume_thousand_vagons, share_percent)
            VALUES (?, ?, ?, ?)""",
         lambda r: (r["ID предприятия"], i(r["Период"]),
                    f(r["Производство вагонов, тыс. вагонов в год"]),
                    f(r["Доля от общего объема производства, %"])))

    load("ВСЗ_Контакты",
         """INSERT INTO manufacturer_contacts
            (manufacturer_id, department_id, contact_name, phone, email, is_primary_for_vagon_card)
            VALUES (?, ?, ?, ?, ?, ?)""",
         lambda r: (r["ID предприятия"], c(r["ID подразделения"]), c(r["Наименование"]),
                    c(r["Телефон"]), c(r["E-mail"]), c(r["Основной для карточки вагона"])))

    print("Вагоны и тележки:")
    load("ID вагоны_общ",
         """INSERT INTO vagons
            (id, vagon_type_id, vagon_kind_id, model, model_note, manufacturer_id, kd_number,
             accounting_specialization, europallet_count, requires_authorization)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
         lambda r: (r["ID вагона"], r["ID тип вагона"], c(r["ID род вагона"]), c(r["Модель"]),
                    c(r["Примечание к модели"]), c(r["ID производителя"]), c(r["Номер КД"]),
                    c(r["Учетная специализация"]), i(r["Количество европаллет, шт."]),
                    c(r["Требуется авторизация"])))

    load("ID тележки_общ",
         """INSERT INTO bogies (id, model, model_note, manufacturer_id, axle_load_tf, axle_load_kn)
            VALUES (?, ?, ?, ?, ?, ?)""",
         lambda r: (r["ID тележки"], r["Модель тележки"], c(r["Примечание к модели"]),
                    c(r["ID производителя"]), f(r["Осевая нагрузка, тс"]), f(r["Осевая нагрузка, кН"])))

    load("Вагон-Тележка",
         "INSERT INTO vagon_bogies (vagon_id, bogie_id) VALUES (?, ?)",
         lambda r: (r["ID вагона"], r["ID тележки"]))

    print("Характеристики по типам вагона:")
    load("Полувагон_Характер",
         """INSERT INTO gondola_char (vagon_id, capacity_t, body_volume_m3, tare_mass_t,
            length_mm, service_life_years, gauge) VALUES (?, ?, ?, ?, ?, ?, ?)""",
         lambda r: (r["ID вагона"], f(r["Грузоподъемность, тонн"]), f(r["Объем кузова, м3"]),
                    f(r["Масса тары, тонн"]), i(r["Длина вагона, мм"]), i(r["Срок службы, лет"]),
                    c(r["Габарит"])))

    load("Цистерны_Характер",
         """INSERT INTO tank_char (vagon_id, capacity_t, boiler_volume_m3, tare_mass_t,
            boiler_inner_diameter_mm, length_mm, service_life_years, gauge)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
         lambda r: (r["ID вагона"], f(r["Грузоподъемность, тонн"]), f(r["Объем котла, м3"]),
                    f(r["Масса тары, тонн"]), i(r["Вн. диаметр котла, мм"]), i(r["Длина вагона, мм"]),
                    i(r["Срок службы, лет"]), c(r["Габарит"])))

    load("Хопперы_Характер",
         """INSERT INTO hopper_char (vagon_id, capacity_t, body_volume_m3, tare_mass_t, length_mm,
            loading_hatches_count, unloading_hatches_count, service_life_years, gauge)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
         lambda r: (r["ID вагона"], f(r["Грузоподъемность, тонн"]), f(r["Объем кузова, м3"]),
                    f(r["Масса тары, тонн"]), i(r["Длина вагона, мм"]), i(r["Загрузочные люки, шт."]),
                    i(r["Разгрузочные люки, шт."]), i(r["Срок службы, лет"]), c(r["Габарит"])))

    load("Фитин платф_Характер",
         """INSERT INTO fitting_platform_char (vagon_id, capacity_t, length_mm, frame_length_mm,
            base_mm, width_mm, fittings_total, fittings_folding, tare_mass_t, service_life_years, gauge)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
         lambda r: (r["ID вагона"], f(r["Грузоподъемность, тонн"]), i(r["Длина вагона, мм"]),
                    i(r["Длина по раме, мм"]), i(r["База вагона, мм"]), i(r["Ширина вагона, мм"]),
                    i(r["Фитинг. уп. всего, шт."]), i(r["Фитинг. уп. откид., шт"]),
                    f(r["Масса тары, тонн"]), i(r["Срок службы, лет"]), c(r["Габарит"])))

    load("Лесовоз платф_Характер",
         """INSERT INTO timber_platform_char (vagon_id, capacity_t, body_volume_m3, length_mm,
            frame_length_mm, base_mm, width_mm, stanchions_count, fittings_total, tare_mass_t,
            service_life_years, gauge) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
         lambda r: (r["ID вагона"], f(r["Грузоподъемность, тонн"]), f(r["Объем кузова, м3"]),
                    i(r["Длина вагона, мм"]), i(r["Длина по раме, мм"]), i(r["База вагона, мм"]),
                    i(r["Ширина вагона, мм"]), i(r["Кол-во стоек, шт."]), i(r["Фитинг. уп. всего, шт."]),
                    f(r["Масса тары, тонн"]), i(r["Срок службы, лет"]), c(r["Габарит"])))

    load("Универс платф_Характер",
         """INSERT INTO universal_platform_char (vagon_id, capacity_t, frame_length_mm, width_mm,
            base_mm, floor_area_m2, tare_mass_t, length_mm, service_life_years, gauge)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
         lambda r: (r["ID вагона"], f(r["Грузоподъемность, тонн"]), i(r["Длина по раме, мм"]),
                    i(r["Ширина вагона, мм"]), i(r["База вагона, мм"]), f(r["Площадь пола, м2"]),
                    f(r["Масса тары, тонн"]), i(r["Длина вагона, мм"]), i(r["Срок службы, лет"]),
                    c(r["Габарит"])))

    load("Платф для прокат_Характер",
         """INSERT INTO rolled_metal_platform_char (vagon_id, capacity_t, frame_length_mm, width_mm,
            base_mm, tare_mass_t, length_mm, service_life_years, gauge)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
         lambda r: (r["ID вагона"], f(r["Грузоподъемность, тонн"]), i(r["Длина по раме, мм"]),
                    i(r["Ширина вагона, мм"]), i(r["База вагона, мм"]), f(r["Масса тары, тонн"]),
                    i(r["Длина вагона, мм"]), i(r["Срок службы, лет"]), c(r["Габарит"])))

    load("Проч платф_Характер",
         """INSERT INTO other_platform_char (vagon_id, capacity_t, frame_length_mm, width_mm, base_mm,
            stanchions_count, end_walls, fittings_total, tare_mass_t, length_mm, service_life_years, gauge)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
         lambda r: (r["ID вагона"], f(r["Грузоподъемность, тонн"]), i(r["Длина по раме, мм"]),
                    i(r["Ширина вагона, мм"]), i(r["База вагона, мм"]), i(r["Кол-во стоек, шт."]),
                    c(r["Торцевые стенки"]), i(r["Фитинг. уп. всего, шт."]), f(r["Масса тары, тонн"]),
                    i(r["Длина вагона, мм"]), i(r["Срок службы, лет"]), c(r["Габарит"])))

    load("Крыт ваг_Характер",
         """INSERT INTO covered_wagon_char (vagon_id, capacity_t, body_volume_m3, floor_area_m2,
            door_opening_width_mm, door_opening_height_mm, inner_length_mm, inner_width_mm,
            inner_height_mm, tare_mass_t, fittings_total, length_mm, service_life_years, gauge)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
         lambda r: (r["ID вагона"], f(r["Грузоподъемность, тонн"]), f(r["Объем кузова, м3"]),
                    f(r["Площадь пола, м2"]), i(r["Ширина двер. пр., мм"]), i(r["Высота. двер. пр., мм"]),
                    i(r["Длина кузова вн., мм"]), i(r["Ширина кузова вн., мм"]), i(r["Высота кузова вн., мм"]),
                    f(r["Масса тары, тонн"]), i(r["Фитинг. уп. всего, шт."]), i(r["Длина вагона, мм"]),
                    i(r["Срок службы, лет"]), c(r["Габарит"])))

    load("Изотермы_Характер",
         """INSERT INTO reefer_char (vagon_id, capacity_t, body_volume_m3, floor_area_m2,
            inner_length_mm, inner_width_mm, inner_height_mm, tare_mass_t, length_mm, temp_range_c,
            heat_transfer_coef, transport_duration_days, service_life_years, gauge)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
         lambda r: (r["ID вагона"], f(r["Грузоподъемность, тонн"]), f(r["Объем кузова, м3"]),
                    f(r["Площадь пола, м2"]), i(r["Длина кузова вн., мм"]), i(r["Ширина кузова вн., мм"]),
                    i(r["Высота кузова вн., мм"]), f(r["Масса тары, тонн"]), i(r["Длина вагона, мм"]),
                    c(r["Раб. диапазон t, °C"]), f(r["К-т теплопередачи, Вт/(м2\\*К)"]),
                    f(r["Срок перевозки, сут."]), i(r["Срок службы, лет"]), c(r["Габарит"])))

    load("Самосвалы_Характер",
         """INSERT INTO dump_car_char (vagon_id, capacity_t, body_volume_m3, width_mm, base_mm,
            tare_mass_t, length_mm, axles_count, service_life_years, gauge)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
         lambda r: (r["ID вагона"], f(r["Грузоподъемность, тонн"]), f(r["Объем кузова, м3"]),
                    i(r["Ширина вагона, мм"]), i(r["База вагона, мм"]), f(r["Масса тары, тонн"]),
                    i(r["Длина вагона, мм"]), i(r["Кол-во осей"]), i(r["Срок службы, лет"]),
                    c(r["Габарит"])))

    print("Межремонт, сертификаты, особенности, грузы:")
    load("Межремонт сроки - Вагон",
         """INSERT INTO vagon_overhaul_intervals (vagon_id, criterion, dr_after_build_years,
            dr_after_build_km_thousand, dr_after_dr_years, dr_after_dr_km_thousand,
            dr_after_kr_years, dr_after_kr_km_thousand, kr_after_build_years, kr_after_kr_years)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
         lambda r: (r["ID вагона"], r["Критерий"], f(r["ДР после постройки, лет"]),
                    f(r["ДР после постройки, тыс. км"]), f(r["ДР после ДР, лет"]),
                    f(r["ДР после ДР, тыс. км"]), f(r["ДР после КР, лет"]), f(r["ДР после КР, тыс. км"]),
                    f(r["КР после постройки, лет"]), f(r["КР после КР, лет"])))

    load("Сертификаты-Вагоны",
         """INSERT INTO certificates (id, vagon_id, cert_number, valid_from, valid_to, status)
            VALUES (?, ?, ?, ?, ?, ?)""",
         lambda r: (r["ID сертификата"], r["ID вагона"], c(r["Номер сертификата"]),
                    d(r["Начало действия"]), d(r["Окончание действия"]), c(r["Статус"])))

    load("ID особенности",
         "INSERT INTO vagon_features (id, name) VALUES (?, ?)",
         lambda r: (r["ID особенности вагона"], r["Особенность конструкции вагона"]))

    load("Особенн-Вагон",
         "INSERT INTO vagon_feature_links (vagon_id, feature_id) VALUES (?, ?)",
         lambda r: (r["ID вагона"], r["ID особенности"]))

    load("Платформ-Контейнер",
         "INSERT INTO platform_containers (vagon_id, container_size_id) VALUES (?, ?)",
         lambda r: (r["ID вагона"], r["ID контейнера"]))

    load("ID грузов",
         "INSERT INTO cargo_types (id, etsng_code, name) VALUES (?, ?, ?)",
         lambda r: (r["ID груза"], code(r["Код ЕТСНГ"]), r["Наименование кода ЕТСНГ"]))

    load("Вагон - груз",
         "INSERT INTO vagon_cargo (vagon_id, cargo_id) VALUES (?, ?)",
         lambda r: (r["ID вагона"], r["ID груза"]))

    print("Ремонт: холдинги, депо:")
    load("Ремонт Холдинг",
         """INSERT INTO repair_holdings (id, full_name, short_name, country, enterprise_type,
            website, telegram) VALUES (?, ?, ?, ?, ?, ?, ?)""",
         lambda r: (r["ID холдинга"], r["Наименование ремонтного холдинга"],
                    c(r["Краткое наименование"]), c(r["Страна"]), c(r["Тип предприятия"]),
                    c(r["Сайт"]), c(r["Канал Телеграм"])))

    load("ID желез дорог",
         "INSERT INTO railways (id, name) VALUES (?, ?)",
         lambda r: (r["ID дороги"], r["Наименование дороги"]))

    load("ID ремонтов",
         "INSERT INTO repair_types (id, name) VALUES (?, ?)",
         lambda r: (r["ID ремонта"], r["Наименование"]))

    load("Ремонт холд-Контакты",
         """INSERT INTO repair_holding_contacts (holding_id, contact_name, phone, email)
            VALUES (?, ?, ?, ?)""",
         lambda r: (r["ID холдинга"], c(r["Наименование контакта"]), c(r["Телефон"]), c(r["E-mail"])))

    load("Депо_Характер",
         """INSERT INTO depots (id, holding_id, name, stamp_code, railway_id, adjoining_station,
            station_code, latitude, longitude, website) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
         lambda r: (r["ID депо"], c(r["ID ремонт. холдинга"]), r["Наименование депо"],
                    c(r["Клеймо депо"]), c(r["Дорога"]), c(r["Станция примыкания"]),
                    c(r["Код станции"]), f(r["Широта"]), f(r["Долгота"]), c(r["Сайт"])),
         skip_if=lambda r: not c(r.get("ID депо")))

    load("Депо_Компетенц",
         """INSERT INTO depot_competencies (depot_id, repair_type_id, vagon_type_id, vagon_kind_id, note)
            VALUES (?, ?, ?, ?, ?)""",
         lambda r: (r["ID депо"], r["Вид ремонта"], r["Тип вагона"], c(r["Род вагона"]),
                    c(r["Примечание"])),
         skip_if=lambda r: not c(r.get("ID депо")) or not c(r.get("Вид ремонта")) or not c(r.get("Тип вагона")))

    load("Депо_Авторизац",
         "INSERT INTO depot_authorizations (depot_id, repair_type_id, vagon_id) VALUES (?, ?, ?)",
         lambda r: (r["ID депо"], r["Вид ремонта"], r["ID вагона"]))

    load("ID услуги депо",
         "INSERT INTO depot_services (id, name) VALUES (?, ?)",
         lambda r: (r["ID услуги"], r["Наименование"]))

    load("Услуги-Депо",
         "INSERT INTO depot_service_links (depot_id, service_id) VALUES (?, ?)",
         lambda r: (r["ID вагона"], r["ID услуги"]))  # в источнике колонка названа "ID вагона", по смыслу - ID депо

    load("Депо-Контакты",
         "INSERT INTO depot_contacts (depot_id, contact_name, phone, email) VALUES (?, ?, ?, ?)",
         lambda r: (r["ID депо"], c(r["Наименование контакта"]), c(r["Телефон"]), c(r["E-mail"])))

    print("Комплектующие тележки:")
    load("ID комплект (тип)",
         "INSERT INTO component_types (id, name) VALUES (?, ?)",
         lambda r: (r["ID типа"], r["Наименование"]))

    load("Тележ-Комплект",
         """INSERT INTO bogie_components (id, bogie_id, component_type_id, name, drawing_number)
            VALUES (?, ?, ?, ?, ?)""",
         lambda r: (r["ID комплектующего"], r["ID тележки"], r["ID типа"], c(r["Наименование"]),
                    c(r["№ чертежа"])),
         skip_if=lambda r: not c(r.get("ID комплектующего")))

    load("Тележка-чертеж",
         "INSERT INTO bogie_drawings (bogie_id, drawing_number) VALUES (?, ?)",
         lambda r: (r["ID тележки"], r["№ чертежа"]),
         skip_if=lambda r: not c(r.get("ID тележки")) or not c(r.get("№ чертежа")))

    load_prilozhenie_e(conn, cur)

    conn.commit()

    # ---- проверка целостности ----
    conn.execute("PRAGMA foreign_keys = ON")
    problems = conn.execute("PRAGMA foreign_key_check").fetchall()
    if problems:
        print(f"\n⚠ Найдены нарушения внешних ключей: {len(problems)}")
        for p in problems[:30]:
            print("   ", p)
    else:
        print("\n✓ Проверка внешних ключей пройдена без ошибок")

    n_tables = conn.execute(
        "SELECT count(*) FROM sqlite_master WHERE type='table'").fetchone()[0]
    print(f"✓ Таблиц создано: {n_tables}")
    print(f"✓ База данных: {DB_PATH}")

    conn.close()


if __name__ == "__main__":
    main()
