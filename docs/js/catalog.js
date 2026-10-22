/* ============================================================
   Каталог «Грузовые вагоны»: тип -> род, груз, сортировка и фильтры
   Адреса: #/catalog, #/catalog/T001, #/catalog/T001/ST001,
           #/catalog/cargo/C001,C002[/T001[/ST001]]
   ============================================================ */
const catState = { type: null, kind: null, cargo: [], sort: null, axle: new Set(), mfrs: new Set(), cert: new Set() };

function catalogHash({ type = null, kind = null, cargo = [] } = {}) {
  const tail = [type, type && kind].filter(Boolean).join("/");
  if (cargo.length) return `#/catalog/cargo/${cargo.join(",")}${tail ? "/" + tail : ""}`;
  return `#/catalog${tail ? "/" + tail : ""}`;
}
const catHashWith = patch => catalogHash({ type: catState.type, kind: catState.kind, cargo: catState.cargo, ...patch });

function renderCatalogRoute(params) {
  let cargo = [], rest = params;
  if (params[0] === "cargo") { cargo = (params[1] || "").split(",").filter(id => CARGO_BY_ID.has(id)); rest = params.slice(2); }
  catState.cargo = cargo;
  catState.type = TYPE_META[rest[0]] ? rest[0] : null;
  catState.kind = catState.type && KIND_BY_ID.get(rest[1])?.vagon_type_id === catState.type ? rest[1] : null;
  renderCatalog();
}

/* ---------- выборка ---------- */
function catBase() { // тип/род/груз — «где мы», без пользовательских фильтров
  return VAGONS.filter(v =>
    (!catState.type || v.typeId === catState.type) &&
    (!catState.kind || v.kindId === catState.kind) &&
    catState.cargo.every(cid => v.cargoSet.has(cid)));
}
function catFiltered(base) {
  let list = base.filter(v =>
    (!catState.axle.size || catState.axle.has(v.axle25 ? "25" : "23.5")) &&
    (!catState.mfrs.size || catState.mfrs.has(v.mfrId)) &&
    (!catState.cert.size || catState.cert.has(normStatus(v.cert?.status) || "нет данных")));
  if (catState.sort) {
    const key = catState.sort.key === "cap" ? (v => v.specs.capacity_t) : vagonVolume;
    const dir = catState.sort.dir === "asc" ? 1 : -1;
    list = list.slice().sort((a, b) => {
      const x = key(a), y = key(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return (x - y) * dir;
    });
  }
  return list;
}

/* ---------- карточка модели ---------- */
// дробные числа — с родительным падежом единственного числа: «69,5 тонны»
function fmtTons(n) { return Number.isInteger(n) ? pl(n, "тонна", "тонны", "тонн") : `${fmtNum(n)} тонны`; }
function fmtYears(n) { return Number.isInteger(n) ? pl(n, "год", "года", "лет") : `${fmtNum(n)} года`; }
function vagonCardHTML(v, i = 0) {
  const meta = TYPE_META[v.typeId];
  const kn = kindName(v);
  const vol = vagonVolume(v);
  const specs = [
    ["Грузоподъёмность", v.specs.capacity_t != null ? fmtTons(v.specs.capacity_t) : null],
    vol != null ? [v.specs.boiler_volume_m3 != null ? "Объём котла" : "Объём кузова", `${fmtNum(vol)} м³`]
                : ["Длина вагона", v.specs.length_mm != null ? `${fmtNum(v.specs.length_mm)} мм` : null],
    ["Срок службы", v.specs.service_life_years != null ? fmtYears(v.specs.service_life_years) : null],
  ].filter(([, val]) => val != null);
  return `<div class="vcard" style="animation-delay:${Math.min(i, 11) * 22}ms" onclick="nav('#/vagon/${v.id}')" role="link" tabindex="0" aria-label="${esc(meta.name + " " + v.model)}">
    <div class="vcard-top">${kn ? `<span class="vcard-kind">${esc(kn)}</span>` : "<span></span>"}${v.axle25 ? axleBadge() : ""}</div>
    <div class="vcard-media">${v.photoThumb ? `<img src="${v.photoThumb}" alt="" loading="lazy">` : ICONS[v.typeId]}</div>
    <div class="vcard-name">${esc(meta.name)} <span class="num">${esc(v.model)}</span></div>
    <div class="vcard-mfr">${esc(mfrFull(v.mfrId))}</div>
    <dl class="vcard-specs">${specs.map(([k, val]) => `<div class="vcard-spec"><dt>${k}</dt><dd>${val}</dd></div>`).join("")}</dl>
    <label class="vcard-compare" onclick="event.stopPropagation()"><input type="checkbox" data-cmp="${v.id}" ${compareSet.has(v.id) ? "checked" : ""} onchange="toggleCompare('${v.id}')"> сравнить</label>
  </div>`;
}

/* ---------- панели ---------- */
function typeListPanelHTML(base) {
  const counts = new Map();
  base.forEach(v => counts.set(v.typeId, (counts.get(v.typeId) || 0) + 1));
  const types = TYPE_ORDER.filter(t => counts.has(t));
  return `<div class="panel"><div class="panel-title center">${catState.cargo.length ? "Тип вагона" : "Поиск по типу вагона"}</div>
    <div class="type-list">${types.map(t => `<a class="type-row" href="${catHashWith({ type: t, kind: null })}"><span class="ic">${ICONS[t]}</span>${TYPE_META[t].plural}<span class="n">${counts.get(t)}</span></a>`).join("")}</div>
  </div>`;
}
function kindPanelHTML() {
  const t = catState.type;
  const inType = VAGONS.filter(v => v.typeId === t && catState.cargo.every(cid => v.cargoSet.has(cid)));
  const kinds = DATA.vagonKinds.filter(k => k.vagon_type_id === t)
    .map(k => ({ ...k, n: inType.filter(v => v.kindId === k.id).length })).filter(k => k.n);
  return `<div class="panel"><div class="panel-title center">Типы вагонов</div>
    <div class="type-sel"><span class="ic">${ICONS[t]}</span><span class="nm">${TYPE_META[t].plural}</span>
      <button class="x" title="Убрать тип" onclick="nav('${catHashWith({ type: null, kind: null })}')">✕</button></div>
    ${kinds.length ? `<div class="kind-list">${kinds.map(k => `<a class="kind-row${catState.kind === k.id ? " on" : ""}" href="${catHashWith({ kind: catState.kind === k.id ? null : k.id })}">${esc(k.name)}<span class="n">${k.n}</span></a>`).join("")}</div>` : ""}
    ${catState.kind ? `<button class="kind-back" onclick="nav('${catHashWith({ kind: null })}')">← назад, все роды</button>` : ""}
  </div>`;
}
function cargoPanelHTML() {
  SUGGEST.catcargo = { source: cargoSource, pick: id => { if (!catState.cargo.includes(id)) nav(catHashWith({ cargo: [...catState.cargo, id], type: null, kind: null })); } };
  return `<div class="panel cargo-panel"><div class="panel-title center">Поиск вагонов по грузу</div>
    <div class="eyebrow" style="margin-bottom:8px">Что нужно перевезти</div>
    <div class="chip-input" onclick="$('si-catcargo')?.focus()">
      ${catState.cargo.map(cid => chipHTML(CARGO_BY_ID.get(cid).name, `event.stopPropagation(); nav(catHashWith({cargo: catState.cargo.filter(x => x !== '${cid}')}))`)).join("")}
      <div class="rel" style="flex:1;min-width:140px"><input id="si-catcargo" placeholder="${catState.cargo.length ? "ещё груз…" : "например, «бензин» или «зерно»"}" autocomplete="off"
        oninput="renderSuggest('catcargo')" onfocus="renderSuggest('catcargo')" onkeydown="suggestKey('catcargo', event)" style="width:100%;border:none;outline:none;background:transparent;color:var(--ink);font-size:14px;padding:4px 2px">
        <div class="suggest" id="sg-catcargo" hidden style="min-width:260px"></div></div>
    </div>
    <a class="count-link" href="#/cargo">более ${fmtNum(Math.floor(DATA.cargoTypes.length / 100) / 10)} тыс. наименований</a>
  </div>`;
}
function catAppliedItems() {
  const items = [];
  if (catState.sort) items.push({ k: catState.sort.key === "cap" ? "Грузоподъёмность" : "Объём кузова", v: [catState.sort.dir === "asc" ? "по возрастанию" : "по убыванию"], remove: "catState.sort=null; renderCatalog()" });
  if (catState.axle.size) items.push({ k: "Осевая нагрузка", v: [...catState.axle].map(a => a === "25" ? "25 тс (повышенная)" : "23,5 тс (типовая)"), remove: "catState.axle.clear(); renderCatalog()" });
  if (catState.mfrs.size) items.push({ k: "Производитель", v: [...catState.mfrs].map(mfrShort), remove: "catState.mfrs.clear(); renderCatalog()" });
  if (catState.cert.size) items.push({ k: "Сертификат ТР ТС", v: [...catState.cert].map(certShort), remove: "catState.cert.clear(); renderCatalog()" });
  return items;
}
function catToolbarHTML(base) {
  const mfrCounts = new Map();
  base.forEach(v => mfrCounts.set(v.mfrId, (mfrCounts.get(v.mfrId) || 0) + 1));
  const certCounts = new Map();
  base.forEach(v => { const s = normStatus(v.cert?.status) || "нет данных"; certCounts.set(s, (certCounts.get(s) || 0) + 1); });
  const sortCfg = (key, label) => ({ kind: "sort", label, get: () => catState.sort?.key === key ? catState.sort.dir : null,
    set: dir => { catState.sort = dir ? { key, dir } : null; renderCatalog(); } });
  const multi = (label, opts, set) => ({ kind: "multi", label, opts, get: () => catState[set], set: s => { catState[set] = new Set(s); renderCatalog(); } });
  const hasVolume = base.some(v => vagonVolume(v) != null);
  return `<div class="toolbar">
    ${ddHTML("cat-cap", sortCfg("cap", "По грузоподъёмности"))}
    ${hasVolume ? ddHTML("cat-vol", sortCfg("vol", "По объёму кузова")) : ""}
    ${ddHTML("cat-axle", multi("Осевая нагрузка", [
      { value: "25", label: "25 тс — повышенная", count: base.filter(v => v.axle25).length },
      { value: "23.5", label: "23,5 тс — типовая", count: base.filter(v => !v.axle25).length }], "axle"))}
    ${ddHTML("cat-mfr", multi("Производитель", [...mfrCounts].map(([id, n]) => ({ value: id, label: mfrShort(id), count: n }))
      .sort((a, b) => a.label.localeCompare(b.label, "ru")), "mfrs"))}
    ${ddHTML("cat-cert", multi("Сертификат ТР ТС", [...certCounts].map(([s, n]) => ({ value: s, label: certShort(s), count: n })), "cert"))}
  </div>`;
}

/* ---------- сборка страницы ---------- */
function renderCatalog() {
  const { type, kind, cargo } = catState;
  const base = catBase();
  const list = catFiltered(base);
  const applied = catAppliedItems();
  const clearAll = "catState.sort=null; catState.axle.clear(); catState.mfrs.clear(); catState.cert.clear(); renderCatalog()";
  const intro = !type && !cargo.length;

  const crumbs = [["Главная", "#/"], ["Грузовые вагоны", type || cargo.length ? "#/catalog" : null]];
  if (cargo.length) crumbs.push(["Груз: " + CARGO_BY_ID.get(cargo[0]).name + (cargo.length > 1 ? ` и ещё ${cargo.length - 1}` : ""), type ? catHashWith({ type: null }) : null]);
  if (type) crumbs.push([TYPE_META[type].plural, kind ? catHashWith({ kind: null }) : null]);
  if (kind) crumbs.push([KIND_BY_ID.get(kind).name.replace(/^./, c => c.toUpperCase()), null]);

  let left, right, center;
  if (intro) {
    left = typeListPanelHTML(VAGONS);
    right = cargoPanelHTML();
    center = `<div class="cat-intro"><b>Чем везти?</b>
      <span>${VAGONS.length} моделей грузовых вагонов российского производства.</span>
      <span>Выберите тип вагона слева — или укажите груз справа, и мы покажем, какие модели его возят.</span>
      <div class="rail-rule"></div>
      <a class="go-link" style="margin-top:14px" href="#/mfrs">или начните с завода-производителя</a></div>`;
  } else {
    left = type ? kindPanelHTML() : (appliedHTML(applied, clearAll) + typeListPanelHTML(base));
    right = (type ? appliedHTML(applied, clearAll) : "") + cargoPanelHTML();
    const head = cargo.length
      ? `<div class="cat-head cargo"><h2>Найдено для перевозки</h2>${cargo.map(cid => chipHTML(CARGO_BY_ID.get(cid).name, `nav(catHashWith({cargo: catState.cargo.filter(x => x !== '${cid}')}))`, "lg")).join("")}
         <span class="models">${pl(list.length, "модель", "модели", "моделей")}</span></div>
         ${type ? `<div class="cat-head"><h2 style="font-size:20px">${TYPE_META[type].plural}${kind ? ` <span class="kind" style="font-size:18px">— ${esc(KIND_BY_ID.get(kind).name)}</span>` : ""}</h2></div>` : ""}`
      : `<div class="cat-head"><h2>${TYPE_META[type].plural}</h2>${kind ? `<div class="kind">${esc(KIND_BY_ID.get(kind).name)}</div>` : ""}</div>`;
    let cards;
    if (!list.length) cards = `<div class="empty-state">Ничего не найдено — уберите часть фильтров</div>`;
    else {
      // группировка: в типе без рода — по родам; в режиме груза без типа — по типам
      let groups = null;
      if (type && !kind && !catState.sort) {
        const byKind = new Map();
        list.forEach(v => { const k = v.kindId || "_"; if (!byKind.has(k)) byKind.set(k, []); byKind.get(k).push(v); });
        if (byKind.size > 1) groups = [...byKind].map(([k, vs]) => [k === "_" ? "прочие" : KIND_BY_ID.get(k).name, vs]);
      } else if (!type && !catState.sort) {
        const byType = new Map();
        list.forEach(v => { if (!byType.has(v.typeId)) byType.set(v.typeId, []); byType.get(v.typeId).push(v); });
        if (byType.size > 1) groups = TYPE_ORDER.filter(t => byType.has(t)).map(t => [TYPE_META[t].plural, byType.get(t)]);
      }
      let i = 0;
      cards = groups
        ? groups.map(([title, vs]) => `<div class="kind-group-title">${esc(title)} <span class="mono" style="font-size:13px;color:var(--ink-faint)">${vs.length}</span></div><div class="vgrid">${vs.map(v => vagonCardHTML(v, i++)).join("")}</div>`).join("")
        : `<div class="vgrid">${list.map(v => vagonCardHTML(v, i++)).join("")}</div>`;
    }
    center = head + catToolbarHTML(base) + cards;
  }

  $("view-catalog").innerHTML = bandHTML("Грузовые вагоны") + `<div class="wrap">
    ${crumbsHTML(crumbs)}
    <div class="layout-3">
      <aside class="sticky-side">${left}</aside>
      <div>${center}</div>
      <aside class="sticky-side rail-right">${right}</aside>
    </div>
  </div>`;
}
