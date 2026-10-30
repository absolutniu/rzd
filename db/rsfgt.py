"""Реестр условных номеров клеймения ФБУ «РС ФЖТ» (https://rsfgt.ru/Stamps/IssuedCerts)
-> компетенции депо.

Источник — слепок реестра sources/rsfgt_registry.json (выгружен через браузер, сайт
недоступен из скриптов напрямую). Депо сопоставляется с записью реестра по клейму
(depots.stamp_code, поправки — STAMP_OVERRIDE). Для депо с действующим клеймом
компетенции из Excel (лист «Депо_Компетенц») ЗАМЕНЯЮТСЯ разобранной «Областью
применения» свидетельства. Что не легло в справочники (род вагона, которого у нас
нет; колёсные пары и т.п.) в базу не идёт, а попадает в отчёт РЕЕСТР_КЛЕЙМЕНИЯ.md.
"""
import json
import re
from collections import defaultdict
from pathlib import Path

BASE = Path(__file__).parent
REGISTRY_PATH = BASE / "sources" / "rsfgt_registry.json"
REPORT_PATH = BASE.parent / "РЕЕСТР_КЛЕЙМЕНИЯ.md"

# клеймо в Excel неверное или отсутствует -> клеймо из реестра
STAMP_OVERRIDE = {
    "D008": ("749", "в Excel 4632 — в реестре это пункт подготовки вагонов ст. Латыши (ОАО «РЖД»)"),
    "D113": ("1082", "в Excel клеймо не указано"),
}
ALL_TYPES = "ALL"  # пункт «Вагоны грузовые, отремонтированные ТР-…» без перечня = все типы

# пункт перечня -> (тип, род). Род None = «весь тип»; род в скобках = такого рода в справочнике нет.
# Порядок важен: от частного к общему. Текст приводится к нижнему регистру, «ё» -> «е».
KIND_RULES = [
    (r"дозатор", ("T003", "ST011")),
    (r"хоппер.*(углерод|саж)", ("T008", "ST018")),
    (r"хоппер.*зерн", ("T003", "ST008")),
    (r"хоппер.*(минеральн|удобрен|апатит)", ("T003", "ST009")),
    (r"хоппер.*цемент", ("T003", "ST010")),
    (r"хоппер.*(окатыш|агломерат)", ("T003", "ST012")),
    (r"хоппер.*(глинозем|алюмин)|вагон для перевозки глинозем", ("T003", "(для глинозёма и алюминия)")),
    (r"хоппер", ("T003", "(другой хоппер)")),
    (r"(шести|6-?ти)\s*осн\w*.*(думпкар|самосвал)|(думпкар|самосвал).*33-5170", ("T007", "ST020")),
    (r"думпкар|самосвал", ("T007", "ST019")),
    (r"полувагон.*щеп", ("T001", "ST003")),
    (r"полувагон.*(рулон|кокс)", ("T001", "(спец. полувагон)")),
    (r"полувагон", ("T001", None)),
    (r"цистерн.*(сжиж|углевод|углерод\w* газ|пропан|аммиак|бутан)", ("T002", "ST005")),
    (r"цистерн.*(пищев|молок|вин|масл|спирт|паток|сок)", ("T002", "ST007")),
    (r"цистерн.*(кислот|химич|меланж|метанол|азотн|сод|пек|бензол|щелоч|серн|фосфор|каустик|коксохим)", ("T002", "ST006")),
    (r"цистерн.*(нефт|бензин|мазут|вязк|светл|темн)|нефтебензин|нефтебезин", ("T002", "ST004")),
    (r"цистерн", ("T002", "(другая цистерна)")),
    (r"нефтебитум", ("T008", "(для нефтебитума)")),
    (r"платформ.*(фитинг|контейнер)|фитингов", ("T004", "ST013")),
    (r"платформ.*(лес|хлыст)", ("T004", "ST014")),
    (r"платформ.*(лист|рулон|стал|прокат|металл)", ("T004", "ST016")),
    (r"платформ.*труб", ("T004", "ST017")),
    (r"платформ.*(автомоб|двухъярус)", ("T004", "(для автомобилей)")),
    (r"универсальн\w* платформ|платформ\w* универсальн", ("T004", "ST015")),
    (r"платформ", ("T004", "(другая платформа)")),
    (r"термос|изотерм|рефрижератор", ("T006", None)),
    (r"крыт.*автомоб", ("T005", "(для автомобилей)")),
    (r"легковесн|цмгв|цельнометалл", ("T005", "(для легковесных грузов)")),
    (r"крыт", ("T005", None)),
    (r"транспортер", ("T008", "(транспортер)")),
    (r"весоповер", ("T008", "(весоповерочный)")),
]
MODEL_RE = re.compile(r"\b\d{2}-\d{3,4}(?:-\d{2})?[а-яa-z]?\b", re.I)
LAT_LOOKALIKE = str.maketrans("apeocxyk", "арeосхук")  # «Повоpино» с латинской p и т.п.


def _low(s):
    return s.lower().replace("ё", "е")


def _header_repairs(head):
    h = _low(head)
    if "текущ" in h and "отцеп" in h:
        return [f"RT00{2 + int(n)}" for n in sorted(set(re.findall(r"тр[\s-]*([123])", h)))], True
    rts = []
    if "деповск" in h: rts.append("RT001")
    if "капитальн" in h: rts.append("RT002")
    return rts, False


def parse_usage(text):
    """«Область применения» -> (компетенции, пункты по колёсным парам и др.).
    Компетенция: dict(rt, t, k, models, note, text); t == ALL_TYPES — все грузовые вагоны."""
    lines = []
    for ln in [x.strip() for x in text.replace("\r", "").split("\n") if x.strip()]:
        # перенос строки внутри пункта («моделей\n19-9870») — склеиваем
        if lines and not re.match(r"^(\d+\s*\.|-|–|\.)", ln) and not re.match(r"^(Колесн|Вагон)", ln):
            lines[-1] += " " + ln
        else:
            lines.append(ln)
    comps, other = [], []
    rts, axle, mode = [], None, None
    for ln in lines:
        m = re.match(r"^(?:(\d+)\s*\.|\.)\s*(.*)$", ln)
        if m or re.match(r"^(Колесн|Вагон)", ln):
            head = m.group(2) if m else ln
            low = _low(head)
            ax = re.search(r"осев\w* нагрузк\w*\s*([\d,\.]+)", low)
            axle = ax.group(1).replace(".", ",") if ax else None
            if re.search(r"колесн\w* пар|подшипник|буксов", low) or re.search(
                    r"вновь изготовл|модерниз|продлени|установка|датчик", low) or "отремонтир" not in low:
                mode = "other"
                other.append(head.rstrip(":;. "))
                continue
            rts, is_tr = _header_repairs(head)
            if is_tr:
                comps += [dict(rt=rt, t=ALL_TYPES, k=None, models="", note=None, text=head.rstrip(":;. ")) for rt in rts]
                mode = None
            else:
                mode = "comp"
            continue
        item = ln.lstrip("-– ").strip(" ;.,")
        if not item:
            continue
        if mode == "other":
            other[-1] += " / " + item
            continue
        if mode != "comp":
            continue
        low = _low(item)
        hit = next((tk for pat, tk in KIND_RULES if re.search(pat, low)), (None, None))
        models = ", ".join(sorted(set(MODEL_RE.findall(item))))
        # из скобок берём только ограничения объёма («без ремонта котла», «кроме …»), синонимы вроде «(думпкар)» — нет
        note = _scope_note(item)
        comps += [dict(rt=rt, t=hit[0], k=hit[1], models=models, note=note, text=item,
                       models_only=axle == "25,0" and bool(models)) for rt in rts]
    return comps, other


def _scope_note(text):
    """Ограничения объёма из скобок («без ремонта котла», «кроме …»); синонимы вроде «(думпкар)» — нет."""
    return "; ".join(p.strip() for p in re.findall(r"\(([^)]*)\)", text)
                     if re.match(r"\s*(без|кроме|только|в т\.)", _low(p))) or None


def _services(item):
    """Пункт «Колесная пара …» / «… вновь изготовленные» -> услуги депо (RUS…)."""
    low = _low(item)
    out = []
    if "вновь изготовл" in low and re.search(r"колесн|детал|составн", low):
        out.append("RUS003")  # Изготовление запасных частей
    if re.search(r"колесн\w* пар", low) and "отремонтир" in low:
        if re.search(r"текущ|средн", low): out.append("RUS001")  # Участковый ремонт колесных пар
        if "капитальн" in low: out.append("RUS002")  # Капитальный ремонт колесных пар РУ1Ш и РВ2Ш
    return out


def _city(name):
    return _low(re.sub(r"^(ВРД|ВРЗ|ВЧДр|РВД|ВРП|ВКМ)\s+", "", name).replace("«", "").split("-")[0].split()[0])[:5]


def load_rsfgt(conn, cur):
    if not REGISTRY_PATH.exists():
        print("Реестр клеймения rsfgt.ru: слепок не найден, пропускаю")
        return
    reg = json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))
    by_stamp = defaultdict(list)
    for r in reg["rows"]:
        by_stamp[r["stamp"].lstrip("0")].append(r)
    kinds = {k for (k,) in cur.execute("SELECT id FROM vagon_kinds")}
    types = [t for (t,) in cur.execute("SELECT id FROM vagon_types ORDER BY id")]
    tname = dict(cur.execute("SELECT id, name FROM vagon_types"))
    rname = dict(cur.execute("SELECT id, name FROM repair_types"))
    depots = cur.execute("SELECT id, name, stamp_code, holding_id FROM depots ORDER BY id").fetchall()
    vagons_by_model = defaultdict(list)  # «12-196-02» -> [W…]; в vagons.model бывает «15-1271 «Находка»»
    axle25 = set()
    for vid, model, a25 in cur.execute("SELECT id, model, axle_load_25 FROM vagons"):
        m = MODEL_RE.search(model or "")
        if m: vagons_by_model[m.group(0)].append(vid)
        if a25 == "да": axle25.add(vid)

    matched, inactive, unmatched, pending, other_items = [], [], [], defaultdict(list), []
    n_del = n_ins = n_auth = n_svc = 0
    for did, name, stamp, holding in depots:
        override = STAMP_OVERRIDE.get(did)
        stamp = override[0] if override else stamp
        city = _city(name)
        rec = next((r for r in by_stamp.get((stamp or "").lstrip("0"), [])
                    if city in _low(r["org"] + " " + r["place"]).translate(LAT_LOOKALIKE)), None)
        if not rec:
            unmatched.append((did, name, stamp))
            continue
        # реквизиты свидетельства — и для депо с прекращённым клеймом (на сайте пометка)
        cur.execute("""UPDATE depots SET stamp_code = ?, stamp_status = ?, cert_number = ?, cert_valid_until = ?, cert_url = ?,
                       registration_date = ?, inn = COALESCE(NULLIF(?, ''), inn), address = COALESCE(NULLIF(?, ''), address)
                       WHERE id = ?""",
                    (stamp, rec["status"], rec["cert"] or None, rec["valid"] or None,
                     f"https://rsfgt.ru/Stamps/IssuedCerts/{rec['id']}" if rec["id"] not in ("", "0") else None,
                     rec["reg"] or None, rec["inn"], re.sub(r"\s+", " ", rec["place"]).strip(), did))
        if rec["status"] != "Действует":
            inactive.append((did, name, stamp, rec))
            continue
        matched.append((did, name, stamp, rec, override))
        comps, other = parse_usage(rec["usage"])
        svc = {}
        for x in other:
            ids = _services(x)
            if not ids:
                other_items.append((did, name, x))
            for sid in ids:
                svc.setdefault(sid, set())
                if _scope_note(x): svc[sid].add(_scope_note(x))
        for sid, notes in svc.items():  # к услугам из Excel (лист «Услуги-Депо») добавляем, не заменяем
            n_svc += cur.execute("INSERT OR IGNORE INTO depot_service_links (depot_id, service_id, note) VALUES (?, ?, ?)",
                                 (did, sid, "; ".join(sorted(notes)) or None)).rowcount
        # модели из свидетельства -> авторизации (заменяют лист «Депо_Авторизац»): пункты «… 25,0 тс … модели»
        # и модели, отмеченные в каталоге как 25 тс
        auths = {}
        for x in comps:
            for code in filter(None, x["models"].split(", ")):
                for vid in vagons_by_model.get(code, []):
                    if x.get("models_only") or vid in axle25:
                        auths.setdefault((x["rt"], vid), x["note"])
        cur.execute("DELETE FROM depot_authorizations WHERE depot_id = ?", (did,))
        cur.executemany("INSERT INTO depot_authorizations (depot_id, repair_type_id, vagon_id, note) VALUES (?, ?, ?, ?)",
                        [(did, rt, vid, note) for (rt, vid), note in sorted(auths.items())])
        n_auth += len(auths)
        rows = {}  # (rt, t, k) -> note; пункт без примечания перекрывает пункт с примечанием
        for x in comps:
            if x.get("models_only"):
                continue  # ремонт только перечисленных моделей 25 тс — это авторизация, не компетенция на род
            if x["t"] is None or (x["k"] and x["k"] not in kinds):
                pending[(x["t"], x["k"] or "")].append((did, name, rname[x["rt"]], x["text"]))
                continue
            for t in (types if x["t"] == ALL_TYPES else [x["t"]]):
                key = (x["rt"], t, x["k"])
                note = x["note"] if x["t"] != ALL_TYPES else "все грузовые вагоны (свидетельство РС ФЖТ)"
                if key not in rows:
                    rows[key] = note
                elif note is None:
                    rows[key] = None
        n_del += cur.execute("DELETE FROM depot_competencies WHERE depot_id = ?", (did,)).rowcount
        cur.executemany(
            "INSERT INTO depot_competencies (depot_id, repair_type_id, vagon_type_id, vagon_kind_id, note) VALUES (?, ?, ?, ?, ?)",
            [(did, rt, t, k, note) for (rt, t, k), note in sorted(rows.items(), key=lambda kv: (kv[0][0], kv[0][1], kv[0][2] or ""))])
        n_ins += len(rows)

    print(f"Реестр клеймения rsfgt.ru (слепок {reg['fetched'][:10]}): депо с действующим клеймом {len(matched)}, "
          f"компетенций из Excel заменено {n_del} -> {n_ins}; клеймо не действует у {len(inactive)}, "
          f"не найдено {len(unmatched)}; авторизаций на модели {n_auth}, услуг добавлено {n_svc}; не легло в справочник родов: {sum(map(len, pending.values()))} строк")
    _write_report(reg, matched, inactive, unmatched, pending, other_items, tname)


def _write_report(reg, matched, inactive, unmatched, pending, other_items, tname):
    L = ["# Реестр клеймения РС ФЖТ → компетенции депо", "",
         f"Файл генерируется `db/build_db.py` (модуль `db/rsfgt.py`), руками не править.",
         f"Источник: {reg['source']}, слепок от {reg['fetched'][:10]} (`db/sources/rsfgt_registry.json`).", "",
         f"У **{len(matched)}** депо с действующим клеймом компетенции взяты из «Области применения» свидетельства "
         "и заменяют лист «Депо_Компетенц» Excel-основы. Пункты «текущим отцепочным ремонтом ТР-…» без перечня "
         "вагонов заведены на все типы вагонов. Модели из пунктов «… 25,0 тс … модели …» (и модели 25 тс из каталога) "
         "заменяют лист «Депо_Авторизац». Колёсные пары и изготовление деталей добавлены к услугам депо "
         "(текущий/средний ремонт КП → RUS001, капитальный → RUS002, вновь изготовленные → RUS003). "
         "Клеймо, свидетельство, ИНН, адрес производства и дата регистрации тоже берутся из реестра.", ""]
    if any(m[4] for m in matched):
        L += ["## Поправки клейма", "", "| ID | Депо | Клеймо | Почему |", "|---|---|---|---|"]
        L += [f"| {d} | {n} | {s} | {o[1]} |" for d, n, s, _, o in matched if o]
        L.append("")
    if inactive or unmatched:
        L += ["## Депо без действующего клейма", "",
              "На сайте с пометкой «клеймо прекращено»; компетенции у них остаются из Excel (сейчас пусто).", "",
              "| ID | Депо | Клеймо | Статус | Свидетельство |", "|---|---|---|---|---|"]
        L += [f"| {d} | {n} | {s} | {r['status']} | {r['cert'] or '—'} |" for d, n, s, r in inactive]
        L += [f"| {d} | {n} | {s or '—'} | не найдено в реестре | — |" for d, n, s in unmatched]
        L.append("")
    L += ["## Роды вагонов, которых нет в справочнике (пока не используем)", "",
          "Такие пункты свидетельств в базу не загружены. Если род заведём в листе «Род_вагонов» "
          "и добавим правило в `KIND_RULES` (`db/rsfgt.py`), они подхватятся при пересборке.", "",
          "| Тип | Род (как в свидетельствах) | Депо | Строк | Пример формулировки |", "|---|---|---|---|---|"]
    for (t, k), items in sorted(pending.items(), key=lambda kv: -len({i[0] for i in kv[1]})):
        L.append(f"| {tname.get(t, 'не распознан')} | {k.strip('()') or '—'} | {len({i[0] for i in items})} | {len(items)} | {items[0][3]} |")
    L += ["", "<details><summary>По депо</summary>", ""]
    for (t, k), items in sorted(pending.items(), key=lambda kv: (kv[0][0] or "", kv[0][1])):
        L.append(f"**{tname.get(t, 'не распознан')} / {k.strip('()') or '—'}:** " + "; ".join(
            sorted({f"{n} ({', '.join(sorted({i[2] for i in items if i[1] == n}))})" for _, n, _, _ in items})))
        L.append("")
    L += ["</details>", "", "## Прочие пункты свидетельств (не загружены)", "",
          f"{len(other_items)} пунктов у {len({o[0] for o in other_items})} депо: ремонт подшипников и деталей, "
          "модернизация, установка датчиков — подходящей услуги в справочнике нет.", "", "<details><summary>Список</summary>", ""]
    L += [f"- **{n}:** {x}" for _, n, x in other_items]
    L += ["", "</details>", ""]
    REPORT_PATH.write_text("\n".join(L), encoding="utf-8")
