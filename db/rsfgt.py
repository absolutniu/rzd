"""Реестр условных номеров клеймения ФБУ «РС ФЖТ» (https://rsfgt.ru/Stamps/IssuedCerts)
-> компетенции, авторизации и реквизиты депо.

Источник — слепок реестра sources/rsfgt_registry.json (выгружен через браузер, сайт
недоступен из скриптов напрямую). Депо сопоставляется с записью реестра по клейму
(depots.stamp_code, поправки — STAMP_OVERRIDE). Для депо с действующим клеймом
к данным Excel-основы ДОБАВЛЯЕТСЯ то, чего в ней нет: компетенции и авторизации из
«Области применения» свидетельства; реквизиты (ИНН, адрес, дата регистрации) — только
пустые; № свидетельства, срок, статус клейма — всегда из реестра. Услуги депо берутся
только из Excel. Что не легло в справочники (род вагона, которого у нас нет; колёсные
пары и т.п.), попадает в отчёт РЕЕСТР_КЛЕЙМЕНИЯ.md.
"""
import json
import re
from collections import defaultdict
from pathlib import Path

BASE = Path(__file__).parent
REGISTRY_PATH = BASE / "sources" / "rsfgt_registry.json"
REPORT_PATH = BASE.parent / "РЕЕСТР_КЛЕЙМЕНИЯ.md"

# клеймо в Excel неверное или отсутствует: {ID депо: (клеймо из реестра, почему)}.
# ID депо в основе перенумеровываются — после обновления Excel проверить.
STAMP_OVERRIDE = {}
TOR_NOTE = "все грузовые вагоны"  # примечание у текущего ремонта, заведённого на все типы вагонов
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


def _city(name):
    return _low(re.sub(r"^(ВРД|ВРЗ|ВЧДр|РВД|ВРП|ВКМ)\s+", "", name).replace("«", "").split("-")[0].split()[0])[:5]


LEGAL_FORMS = r"общество с ограниченной ответственностью|акционерное общество|публичное акционерное общество|ооо|пао|оао|зао|ао"


def _title(name):
    """Название без организационно-правовой формы и кавычек: «ООО «Техкомплекс»» -> «техкомплекс»."""
    words = " " + re.sub(r"[^а-яa-z0-9]+", " ", _low(name)) + " "
    return re.sub(rf" (?:{LEGAL_FORMS})(?= )", "", words).strip()


def _pick(cands, name, inn):
    """Запись реестра для депо: по клейму; среди нескольких — та, где совпал город или ИНН.
    -> (запись, совпало ли название/ИНН)."""
    city = _city(name)
    by_name = [r for r in cands if len(city) >= 3 and city in _low(r["org"] + " " + r["place"]).translate(LAT_LOOKALIKE)]
    by_inn = [r for r in cands if inn and r["inn"] == inn]
    title = _title(name)
    by_title = [r for r in cands if len(title) >= 4 and title in _title(r["org"])]
    for group, ok in ((by_name, True), (by_inn, True), (by_title, True), (cands, False)):
        if group:
            return sorted(group, key=lambda r: r["status"] != "Действует")[0], ok
    return None, False


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
    depots = cur.execute("SELECT id, name, stamp_code, inn FROM depots ORDER BY id").fetchall()
    vagons_by_model = defaultdict(list)  # «12-196-02» -> [W…]; в vagons.model бывает «15-1271 «Находка»»
    axle25 = set()
    for vid, model, a25 in cur.execute("SELECT id, model, axle_load_25 FROM vagons"):
        m = MODEL_RE.search(model or "")
        if m: vagons_by_model[m.group(0)].append(vid)
        if a25 == "да": axle25.add(vid)
    have_comp = defaultdict(set)
    for d, rt, t, k in cur.execute("SELECT depot_id, repair_type_id, vagon_type_id, vagon_kind_id FROM depot_competencies"):
        have_comp[d].add((rt, t, k))
    have_auth = defaultdict(set)
    for d, rt, v in cur.execute("SELECT depot_id, repair_type_id, vagon_id FROM depot_authorizations"):
        have_auth[d].add((rt, v))

    matched, inactive, unmatched, unsure, pending, other_items = [], [], [], [], defaultdict(list), []
    n_comp = n_auth = 0
    for did, name, stamp, inn in depots:
        override = STAMP_OVERRIDE.get(did)
        stamp = override[0] if override else stamp
        rec, sure = _pick(by_stamp.get((stamp or "").lstrip("0"), []), name, inn)
        if not rec:
            unmatched.append((did, name, stamp))
            continue
        if not sure:
            unsure.append((did, name, stamp, rec))
        # реквизиты свидетельства — и для депо с прекращённым клеймом (на сайте пометка)
        cur.execute("""UPDATE depots SET stamp_code = ?, stamp_status = ?, cert_number = ?, cert_valid_until = ?, cert_url = ?,
                       registration_date = COALESCE(registration_date, NULLIF(?, '')),
                       inn = COALESCE(NULLIF(inn, ''), NULLIF(?, '')), address = COALESCE(NULLIF(address, ''), NULLIF(?, ''))
                       WHERE id = ?""",
                    (stamp, rec["status"], rec["cert"] or None, rec["valid"] or None,
                     f"https://rsfgt.ru/Stamps/IssuedCerts/{rec['id']}" if rec["id"] not in ("", "0") else None,
                     rec["reg"], rec["inn"], re.sub(r"\s+", " ", rec["place"]).strip(), did))
        if rec["status"] != "Действует":
            inactive.append((did, name, stamp, rec))
            continue
        matched.append((did, name, stamp, rec, override))
        comps, other = parse_usage(rec["usage"])
        other_items += [(did, name, x) for x in other]
        # модели из свидетельства -> авторизации: пункты «… 25,0 тс … модели» и модели, отмеченные в каталоге как 25 тс
        auths = {}
        for x in comps:
            for code in filter(None, x["models"].split(", ")):
                for vid in vagons_by_model.get(code, []):
                    if (x.get("models_only") or vid in axle25) and (x["rt"], vid) not in have_auth[did]:
                        auths.setdefault((x["rt"], vid), x["note"])
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
                if key in have_comp[did]:
                    continue  # уже есть в Excel — оставляем как там
                note = x["note"] if x["t"] != ALL_TYPES else TOR_NOTE
                if key not in rows:
                    rows[key] = note
                elif note is None:
                    rows[key] = None
        cur.executemany(
            "INSERT INTO depot_competencies (depot_id, repair_type_id, vagon_type_id, vagon_kind_id, note) VALUES (?, ?, ?, ?, ?)",
            [(did, rt, t, k, note) for (rt, t, k), note in sorted(rows.items(), key=lambda kv: (kv[0][0], kv[0][1], kv[0][2] or ""))])
        n_comp += len(rows)

    print(f"Реестр клеймения rsfgt.ru (слепок {reg['fetched'][:10]}): депо с действующим клеймом {len(matched)}, "
          f"добавлено к Excel компетенций {n_comp}, авторизаций {n_auth}; клеймо не действует у {len(inactive)}, "
          f"не найдено в слепке {len(unmatched)}, сопоставлено только по клейму {len(unsure)}; "
          f"не легло в справочник родов: {sum(map(len, pending.values()))} строк")
    _write_report(reg, matched, inactive, unmatched, unsure, pending, other_items, tname)


def _write_report(reg, matched, inactive, unmatched, unsure, pending, other_items, tname):
    one_line = lambda s: re.sub(r"\s+", " ", s).strip()
    L = ["# Реестр клеймения РС ФЖТ → депо", "",
         f"Файл генерируется `db/build_db.py` (модуль `db/rsfgt.py`), руками не править.",
         f"Источник: {reg['source']}, слепок от {reg['fetched'][:10]} (`db/sources/rsfgt_registry.json`).", "",
         f"У **{len(matched)}** депо с действующим клеймом к данным Excel-основы добавлено то, чего в ней нет: "
         "компетенции из «Области применения» свидетельства (пункты «текущим отцепочным ремонтом ТР-…» без перечня "
         "вагонов — на все типы вагонов) и авторизации на модели из пунктов «… 25,0 тс … модели …» и на модели 25 тс "
         "из каталога. № свидетельства, срок и статус клейма — из реестра; ИНН, адрес производства и дата регистрации — "
         "из реестра, только если в Excel пусто. Услуги депо — только из Excel.", ""]
    if any(m[4] for m in matched):
        L += ["## Поправки клейма", "", "| ID | Депо | Клеймо | Почему |", "|---|---|---|---|"]
        L += [f"| {d} | {n} | {s} | {o[1]} |" for d, n, s, _, o in matched if o]
        L.append("")
    if unsure:
        L += ["## Сопоставлено только по клейму — проверить", "",
              "Ни город из названия, ни ИНН депо не совпали с записью реестра.", "",
              "| ID | Депо | Клеймо | В реестре |", "|---|---|---|---|"]
        L += [f"| {d} | {one_line(n)} | {s} | {one_line(r['org'])[:120]} |" for d, n, s, r in unsure]
        L.append("")
    if inactive or unmatched:
        L += ["## Депо без действующего клейма", "",
              "Клеймо прекращено/приостановлено — на сайте пометка; данные у них только из Excel.", "",
              "| ID | Депо | Клеймо | Статус | Свидетельство |", "|---|---|---|---|---|"]
        L += [f"| {d} | {one_line(n)} | {s} | {r['status']} | {r['cert'] or '—'} |" for d, n, s, r in inactive]
        L += [f"| {d} | {one_line(n)} | {s or '—'} | нет в слепке реестра | — |" for d, n, s in unmatched]
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
            sorted({f"{one_line(n)} ({', '.join(sorted({i[2] for i in items if i[1] == n}))})" for _, n, _, _ in items})))
        L.append("")
    L += ["</details>", "", "## Колёсные пары, детали, модернизация (не загружены — услуги берутся из Excel)", "",
          f"{len(other_items)} пунктов у {len({o[0] for o in other_items})} депо.", "", "<details><summary>Список</summary>", ""]
    L += [f"- **{one_line(n)}:** {x}" for _, n, x in other_items]
    L += ["", "</details>", ""]
    REPORT_PATH.write_text("\n".join(L), encoding="utf-8")
