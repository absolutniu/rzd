/* Вагонотека — логика сайта. Данные: data/catalog_data.json (генерирует db/export_catalog.py).
   Страницы рендерятся в <section id="view-…"> по адресу после «#/» (простая hash-маршрутизация:
   работает «назад» в браузере и ссылки на конкретную модель/завод/депо). */

/* ============================================================
   Данные и индексы
   ============================================================ */
let DATA, VAGONS, VAGON_BY_ID, TYPE_BY_ID, KIND_BY_ID, MFR_BY_ID, BOGIE_BY_ID, DEPOT_BY_ID, RAILWAY_BY_ID,
    REPAIR_TYPE_BY_ID, HOLDING_BY_ID, FEATURE_BY_ID, CONTAINER_BY_ID, CARGO_BY_ID, CARGO_VAGON_IDS,
    SERVICE_BY_ID, KIT_BY_ID, DETAIL_BY_ID, PART_BY_ID, DRAWING_BY_NUM;

function initFromData(data) {
  DATA = data;
  VAGONS = DATA.vagons;
  VAGON_BY_ID = new Map(VAGONS.map(v => [v.id, v]));
  TYPE_BY_ID = new Map(DATA.vagonTypes.map(t => [t.id, t.name]));
  KIND_BY_ID = new Map(DATA.vagonKinds.map(k => [k.id, k]));
  MFR_BY_ID = new Map(DATA.manufacturers.map(m => [m.id, m]));
  BOGIE_BY_ID = new Map(DATA.bogies.map(b => [b.id, b]));
  DEPOT_BY_ID = new Map(DATA.depots.map(d => [d.id, d]));
  RAILWAY_BY_ID = new Map(DATA.railways.map(r => [r.id, r.name.trim()]));
  REPAIR_TYPE_BY_ID = new Map(DATA.repairTypes.map(r => [r.id, r.name]));
  HOLDING_BY_ID = new Map(DATA.repairHoldings.map(h => [h.id, h]));
  FEATURE_BY_ID = new Map(DATA.features.map(f => [f.id, f.name]));
  CONTAINER_BY_ID = new Map(DATA.containerSizes.map(c => [c.id, c.name]));
  CARGO_BY_ID = new Map(DATA.cargoTypes.map(c => [c.id, c]));
  SERVICE_BY_ID = new Map(DATA.depotServices.map(s => [s.id, s.name]));
  PART_BY_ID = new Map(DATA.vagonParts.map(p => [p.id, p]));
  KIT_BY_ID = new Map(DATA.partKits.map(k => [k.id, k]));
  DETAIL_BY_ID = new Map(DATA.partDetails.map(x => [x.id, x]));
  VAGONS.forEach(v => { v.cargoSet = new Set(v.cargoIds || []); });
  CARGO_VAGON_IDS = new Map();
  VAGONS.forEach(v => (v.cargoIds || []).forEach(cid => {
    if (!CARGO_VAGON_IDS.has(cid)) CARGO_VAGON_IDS.set(cid, new Set());
    CARGO_VAGON_IDS.get(cid).add(v.id);
  }));
  // номер чертежа -> тележки, у которых он производственный (Прил.Е) — чтобы подписать завод
  DRAWING_BY_NUM = new Map();
  Object.entries(DATA.bogieProduction).forEach(([bid, list]) => list.forEach(([, , num]) => {
    if (!DRAWING_BY_NUM.has(num)) DRAWING_BY_NUM.set(num, new Set());
    DRAWING_BY_NUM.get(num).add(bid);
  }));
}

/* ============================================================
   Утилиты
   ============================================================ */
const esc = s => s == null ? "" : String(s).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const $ = id => document.getElementById(id);
function fmtNum(n) {
  if (n === null || n === undefined || n === "") return "—";
  if (typeof n !== "number") return n;
  return n.toLocaleString("ru-RU");
}
function fmtDate(iso) { return iso ? iso.slice(0, 10).split("-").reverse().join(".") : null; }
function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}
const pl = (n, one, few, many) => `${fmtNum(n)} ${plural(n, one, few, many)}`;
function siteLink(url, label) {
  if (!url) return "";
  const u = url.trim();
  return `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(label || u.replace(/^https?:\/\//, "").replace(/\/$/, ""))}</a>`;
}
function kindName(v) { return v.kindId ? (KIND_BY_ID.get(v.kindId)?.name || null) : null; }
function mfrShort(id) { const m = MFR_BY_ID.get(id); return m ? (m.short_name || m.full_name) : (id || "—"); }
function mfrFull(id) { const m = MFR_BY_ID.get(id); return m ? m.full_name : (id || "—"); }
function certClass(status) {
  if (!status) return "";
  const s = status.toLowerCase();
  return s.startsWith("действ") ? "st-ok" : s.startsWith("приост") ? "st-warn" : "st-danger";
}
function certShort(status) {
  if (!status) return "—";
  const s = status.trim().toLowerCase();
  return s.startsWith("срок") ? "срок закончился" : s;
}
const normStatus = s => (s || "").trim();
const isCargoStub = c => !c || /^нет данных/i.test(c.name);
function vagonCargoIds(v) { return (v.cargoIds || []).filter(cid => !isCargoStub(CARGO_BY_ID.get(cid))); }
function vagonVolume(v) { return v.specs.body_volume_m3 ?? v.specs.boiler_volume_m3 ?? null; }
function bandHTML(title, sub) { return `<div class="page-band"><div class="wrap"><h1>${title}</h1>${sub ? `<p class="sub">${sub}</p>` : ""}</div></div>`; }
function crumbsHTML(items) {
  return `<div class="breadcrumbs">` + items.map((it, i) => {
    const last = i === items.length - 1;
    const part = last || !it[1] ? `<span class="${last ? "cur" : ""}">${esc(it[0])}</span>` : `<a href="${it[1]}">${esc(it[0])}</a>`;
    return part + (last ? "" : `<span class="sep">/</span>`);
  }).join("") + `</div>`;
}
function haversineKm(a, b) {
  const R = 6371, rad = x => x * Math.PI / 180;
  const dLat = rad(b.latitude - a.latitude), dLon = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/* ============================================================
   Иконки и справочные подписи
   ============================================================ */
const ICONS = {
  T001: `<svg viewBox="0 0 64 44" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 14h52v18H6z"/><path d="M14 14v18M22 14v18M30 14v18M38 14v18M46 14v18" stroke-width="1.3" opacity=".55"/><circle cx="16" cy="36" r="3.4" fill="currentColor" stroke="none"/><circle cx="48" cy="36" r="3.4" fill="currentColor" stroke="none"/></svg>`,
  T002: `<svg viewBox="0 0 64 44" fill="none" stroke="currentColor" stroke-width="2"><rect x="8" y="12" width="48" height="18" rx="9"/><rect x="27" y="6" width="10" height="7" rx="1.5"/><circle cx="17" cy="35" r="3.4" fill="currentColor" stroke="none"/><circle cx="47" cy="35" r="3.4" fill="currentColor" stroke="none"/></svg>`,
  T003: `<svg viewBox="0 0 64 44" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 12h44l-4 18H14z"/><path d="M20 30l4 6h16l4-6" stroke-width="1.6"/><path d="M18 12l8-6h12l8 6" stroke-width="1.6"/><circle cx="18" cy="38" r="3" fill="currentColor" stroke="none"/><circle cx="46" cy="38" r="3" fill="currentColor" stroke="none"/></svg>`,
  T004: `<svg viewBox="0 0 64 44" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 22h56v5H4z"/><path d="M10 22v-6M20 22v-6M44 22v-6M54 22v-6" stroke-width="1.6"/><circle cx="14" cy="33" r="3.4" fill="currentColor" stroke="none"/><circle cx="50" cy="33" r="3.4" fill="currentColor" stroke="none"/></svg>`,
  T005: `<svg viewBox="0 0 64 44" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 30V16h52v14z"/><path d="M6 16 16 8h32l10 8" stroke-width="1.6"/><rect x="27" y="16" width="10" height="14" stroke-width="1.4"/><circle cx="16" cy="36" r="3.4" fill="currentColor" stroke="none"/><circle cx="48" cy="36" r="3.4" fill="currentColor" stroke="none"/></svg>`,
  T006: `<svg viewBox="0 0 64 44" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="10" width="52" height="20" rx="6"/><path d="M6 16h52M6 24h52" stroke-width="1.2" opacity=".5"/><path d="M46 14v12M41 17l10 6M41 23l10-6" stroke-width="1.3"/><circle cx="16" cy="36" r="3.4" fill="currentColor" stroke="none"/><circle cx="48" cy="36" r="3.4" fill="currentColor" stroke="none"/></svg>`,
  T007: `<svg viewBox="0 0 64 44" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 12h44v12l-6 6H16l-6-6z"/><path d="M22 30v4M42 30v4" stroke-width="1.6"/><circle cx="17" cy="37" r="3.4" fill="currentColor" stroke="none"/><circle cx="47" cy="37" r="3.4" fill="currentColor" stroke="none"/></svg>`,
  T008: `<svg viewBox="0 0 64 44" fill="none" stroke="currentColor" stroke-width="2"><rect x="8" y="13" width="48" height="16" rx="2"/><path d="M8 21h48" stroke-width="1.3" opacity=".55"/><circle cx="17" cy="35" r="3.4" fill="currentColor" stroke="none"/><circle cx="47" cy="35" r="3.4" fill="currentColor" stroke="none"/></svg>`,
};
const AXLE_SVG = `<svg viewBox="0 0 32 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 5v14M29 5v14M3 15h26"/><text x="16" y="10" text-anchor="middle" font-size="8.5" font-weight="700" fill="currentColor" stroke="none" font-family="Segoe UI,Arial,sans-serif">25</text><text x="16" y="22.5" text-anchor="middle" font-size="5.5" fill="currentColor" stroke="none" font-family="Segoe UI,Arial,sans-serif">тс</text></svg>`;
const axleBadge = (title = "Повышенная осевая нагрузка 25 тс") => `<span class="axle-badge" title="${esc(title)}">${AXLE_SVG}</span>`;
const SORT_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4"/></svg>`;
const FILTER_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg>`;
const CHEV_SVG = `<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>`;

const TYPE_META = {
  T001: { name: "Полувагон", plural: "Полувагоны" },
  T002: { name: "Цистерна", plural: "Цистерны" },
  T003: { name: "Хоппер", plural: "Хопперы" },
  T004: { name: "Платформа", plural: "Платформы" },
  T005: { name: "Крытый вагон", plural: "Крытые" },
  T006: { name: "Изотермический вагон", plural: "Изотермические" },
  T007: { name: "Думпкар", plural: "Думпкары" },
  T008: { name: "Вагон", plural: "Прочие" },
};
const TYPE_ORDER = Object.keys(TYPE_META);
const FIELD_LABELS = {
  capacity_t: ["Грузоподъёмность", " т"], body_volume_m3: ["Объём кузова", " м³"], boiler_volume_m3: ["Объём котла", " м³"],
  tare_mass_t: ["Масса тары", " т"], length_mm: ["Длина вагона", " мм"], frame_length_mm: ["Длина по раме", " мм"],
  base_mm: ["База вагона", " мм"], width_mm: ["Ширина вагона", " мм"], floor_area_m2: ["Площадь пола", " м²"],
  boiler_inner_diameter_mm: ["Вн. диаметр котла", " мм"], loading_hatches_count: ["Загрузочные люки", " шт."],
  unloading_hatches_count: ["Разгрузочные люки", " шт."], fittings_total: ["Фитинговые упоры, всего", " шт."],
  fittings_folding: ["в т.ч. откидные", " шт."], stanchions_count: ["Количество стоек", " шт."], end_walls: ["Торцевые стенки", ""],
  door_opening_width_mm: ["Ширина дверного проёма", " мм"], door_opening_height_mm: ["Высота дверного проёма", " мм"],
  inner_length_mm: ["Длина кузова внутр.", " мм"], inner_width_mm: ["Ширина кузова внутр.", " мм"], inner_height_mm: ["Высота кузова внутр.", " мм"],
  temp_range_c: ["Рабочий диапазон t°", ""], heat_transfer_coef: ["К-т теплопередачи", " Вт/(м²·К)"], transport_duration_days: ["Срок перевозки", " сут."],
  axles_count: ["Количество осей", ""], service_life_years: ["Срок службы", " лет"], gauge: ["Габарит", ""],
};
const FIELD_ORDER = Object.keys(FIELD_LABELS);

/* ============================================================
   Маршрутизация (#/путь/параметры)
   ============================================================ */
// имена, а не ссылки: функции страниц объявлены в js/*.js, которые грузятся после этого файла
const VIEWS = {
  "": "renderHub", catalog: "renderCatalogRoute", vagon: "renderVagon", mfrs: "renderMfrs", mfr: "renderMfr", cargo: "renderCargoPage",
  depots: "renderDepotsRoute", depot: "renderDepotsRoute", parts: "renderPartsRoute", compare: "renderCompare",
  nearest: "renderNearest", new: "renderNew", about: "renderAbout", contacts: "renderContacts",
};
const VIEW_SECTION = { "": "hub", depot: "depots" };
function route() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent).filter(s => s !== "");
  const name = parts[0] && VIEWS[parts[0]] ? parts[0] : "";
  const sectionId = "view-" + (VIEW_SECTION[name] || name);
  closeAllDropdowns();
  hideSearchSuggest();
  document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.id === sectionId));
  $("nav-new").classList.toggle("active", name === "new");
  $("nav-nearest").classList.toggle("active", name === "nearest");
  $("nav-compare").classList.toggle("active", name === "compare");
  const group = VIEW_SECTION[name] || name; // depots и depot — одна страница
  const keepScroll = route.lastGroup === group && ["catalog", "depots", "parts", "cargo"].includes(group);
  window[VIEWS[name]](parts.slice(1));
  updateCompareTray();
  if (!keepScroll) window.scrollTo(0, 0);
  route.lastName = name;
  route.lastGroup = group;
}
function nav(hash) { if (location.hash === hash) route(); else location.hash = hash; }

/* ============================================================
   Выпадающие кнопки (сортировка / фильтр) — общий компонент
   ============================================================ */
const DD = {}; // id -> {opts, kind: "sort"|"multi", label, icon, get(), set(), searchable}
function ddHTML(id, cfg) {
  DD[id] = cfg;
  const active = cfg.kind === "sort" ? !!cfg.get() : cfg.get().size > 0;
  return `<div class="dd" id="dd-${id}">
    <button class="dd-btn${active ? " on" : ""}" onclick="toggleDropdown('${id}', event)" aria-haspopup="true">
      ${cfg.kind === "sort" ? SORT_SVG : FILTER_SVG}<span>${esc(cfg.label)}</span>${CHEV_SVG}
    </button>
  </div>`;
}
function closeAllDropdowns() { document.querySelectorAll(".dd.open").forEach(d => { d.classList.remove("open"); d.querySelector(".dd-pop")?.remove(); }); }
function toggleDropdown(id, ev) {
  ev?.stopPropagation();
  const el = $("dd-" + id);
  const wasOpen = el.classList.contains("open");
  closeAllDropdowns();
  if (wasOpen) return;
  const cfg = DD[id];
  el.classList.add("open");
  const pop = document.createElement("div");
  pop.className = "dd-pop";
  pop.addEventListener("click", e => e.stopPropagation());
  if (cfg.kind === "sort") {
    const cur = cfg.get();
    pop.innerHTML = [["asc", "По возрастанию"], ["desc", "По убыванию"]].map(([v, l]) =>
      `<label class="dd-opt"><input type="radio" name="dd-${id}" ${cur === v ? "checked" : ""} onchange="DD['${id}'].set('${v}'); closeAllDropdowns()"> ${l}</label>`).join("")
      + (cur ? `<button class="more-link" onclick="DD['${id}'].set(null); closeAllDropdowns()">сбросить сортировку</button>` : "");
  } else {
    const draft = new Set(cfg.get());
    cfg._draft = draft;
    pop.innerHTML = `${cfg.opts.length > 7 ? `<input class="dd-search" placeholder="Найти в списке" oninput="filterDropdown('${id}', this.value)">` : ""}
      <div class="dd-list" id="ddl-${id}">${cfg.opts.map(o => `<label class="dd-opt" data-q="${esc(o.label.toLowerCase())}"><input type="checkbox" ${draft.has(o.value) ? "checked" : ""} onchange="DD['${id}']._draft[this.checked?'add':'delete']('${esc(o.value)}')"> ${esc(o.label)}${o.count != null ? `<span class="n">${o.count}</span>` : ""}</label>`).join("")}</div>
      <button class="btn dd-done" onclick="DD['${id}'].set(DD['${id}']._draft); closeAllDropdowns()">Готово</button>`;
  }
  el.appendChild(pop);
  pop.querySelector(".dd-search")?.focus();
}
function filterDropdown(id, q) {
  q = q.trim().toLowerCase();
  document.querySelectorAll(`#ddl-${id} .dd-opt`).forEach(o => { o.hidden = q && !o.dataset.q.includes(q); });
}
document.addEventListener("click", closeAllDropdowns);
function appliedHTML(items, clearFn) {
  if (!items.length) return "";
  return `<div class="panel"><div class="panel-title center">Фильтр</div><div class="applied">
    ${items.map(it => `<div class="applied-item"><button class="x" title="Убрать" onclick="${it.remove}">✕</button><div><div class="k">${esc(it.k)}:</div>${it.v.map(v => `<div class="v">${esc(v)}</div>`).join("")}</div></div>`).join("")}
    ${items.length > 1 && clearFn ? `<button class="more-link applied-clear" onclick="${clearFn}">сбросить все</button>` : ""}
  </div></div>`;
}

/* ============================================================
   Поле-подсказка (груз / модель / депо): общий компонент
   ============================================================ */
const SUGGEST = {}; // id -> {source(q) -> [{id,label,sub}], pick(id)}
let suggestHi = -1;
function suggestInputHTML(id, placeholder, cls = "") {
  return `<div class="rel"><input class="text-input ${cls}" id="si-${id}" placeholder="${esc(placeholder)}" autocomplete="off"
    oninput="renderSuggest('${id}')" onfocus="renderSuggest('${id}')" onkeydown="suggestKey('${id}', event)"><div class="suggest" id="sg-${id}" hidden></div></div>`;
}
function renderSuggest(id) {
  const box = $("sg-" + id), input = $("si-" + id);
  if (!box || !input) return;
  const q = input.value.trim();
  if (q.length < 1) { box.hidden = true; return; }
  const items = SUGGEST[id].source(q.toLowerCase()).slice(0, 12);
  suggestHi = items.length ? 0 : -1;
  box.innerHTML = items.length ? items.map((it, i) => `<div class="suggest-item${i === 0 ? " hi" : ""}" data-id="${esc(it.id)}" onmousedown="event.preventDefault(); pickSuggest('${id}', this.dataset.id)"><span>${esc(it.label)}</span><span class="code">${esc(it.sub || "")}</span></div>`).join("")
    : `<div class="suggest-empty">Ничего не нашлось</div>`;
  box.hidden = false;
}
function pickSuggest(id, value) {
  const input = $("si-" + id);
  if (input) input.value = "";
  $("sg-" + id).hidden = true;
  SUGGEST[id].pick(value);
}
function suggestKey(id, e) {
  const box = $("sg-" + id);
  const items = [...box.querySelectorAll(".suggest-item")];
  if (e.key === "Escape") { box.hidden = true; return; }
  if (!items.length || box.hidden) return;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    suggestHi = Math.max(0, Math.min(items.length - 1, suggestHi + (e.key === "ArrowDown" ? 1 : -1)));
    items.forEach((el, i) => el.classList.toggle("hi", i === suggestHi));
    items[suggestHi].scrollIntoView({ block: "nearest" });
  } else if (e.key === "Enter") {
    e.preventDefault();
    const el = items[suggestHi] || items[0];
    if (el) pickSuggest(id, el.dataset.id);
  }
}
document.addEventListener("focusout", e => {
  if (e.target.id?.startsWith("si-")) setTimeout(() => { const b = $("sg-" + e.target.id.slice(3)); if (b) b.hidden = true; }, 120);
});
const cargoSource = q => {
  if (q.length < 2) return [];
  const starts = [], contains = [];
  for (const c of DATA.cargoTypes) {
    if (isCargoStub(c)) continue;
    const n = c.name.toLowerCase();
    if (n.startsWith(q)) starts.push(c); else if (n.includes(q) || (c.etsng_code || "").startsWith(q)) contains.push(c);
  }
  return starts.concat(contains).map(c => ({ id: c.id, label: c.name, sub: CARGO_VAGON_IDS.has(c.id) ? pl(CARGO_VAGON_IDS.get(c.id).size, "модель", "модели", "моделей") : c.etsng_code }));
};
const vagonSource = q => VAGONS.filter(v => v.model.toLowerCase().includes(q))
  .sort((a, b) => a.model.toLowerCase().indexOf(q) - b.model.toLowerCase().indexOf(q) || a.model.localeCompare(b.model, "ru"))
  .map(v => ({ id: v.id, label: v.model, sub: `${TYPE_META[v.typeId].name} · ${mfrShort(v.mfrId)}` }));
const depotSource = q => DATA.depots.filter(d => d.name.toLowerCase().includes(q) || (d.adjoining_station || "").toLowerCase().includes(q))
  .map(d => ({ id: d.id, label: d.name, sub: RAILWAY_BY_ID.get(d.railway_id) || "" }));
const chipHTML = (label, removeJs, cls = "") => `<span class="chip ${cls}"><span class="t" title="${esc(label)}">${esc(label)}</span><button onclick="${removeJs}" title="Убрать">✕</button></span>`;

/* ============================================================
   Глобальный поиск в шапке: модели, заводы, депо
   ============================================================ */
let gsHi = 0;
function globalResults(q) {
  q = q.trim().toLowerCase();
  if (!q) return [];
  const out = [];
  vagonSource(q).slice(0, 7).forEach(it => out.push({ g: "Вагоны", label: it.label, sub: it.sub, href: `#/vagon/${it.id}` }));
  DATA.manufacturers.filter(m => (m.short_name || "").toLowerCase().includes(q) || m.full_name.toLowerCase().includes(q)).slice(0, 5)
    .forEach(m => out.push({ g: "Заводы", label: m.short_name || m.full_name, sub: m.city || "", href: `#/mfr/${(m.parent_id && !mfrHasPage(m)) ? m.parent_id : m.id}` }));
  depotSource(q).slice(0, 5).forEach(it => out.push({ g: "Депо", label: it.label, sub: it.sub, href: `#/depot/${it.id}` }));
  return out;
}
function renderSearchSuggest() {
  const q = $("search").value, box = $("search-suggest");
  if (!q.trim()) { box.hidden = true; return; }
  const res = globalResults(q);
  gsHi = 0;
  let g = null;
  box.innerHTML = res.length ? res.map((r, i) => {
    const head = r.g !== g ? `<div class="gs-group">${r.g}</div>` : "";
    g = r.g;
    return head + `<div class="gs-item${i === 0 ? " hi" : ""}" data-href="${r.href}" onmousedown="event.preventDefault(); goSearch('${r.href}')"><span>${esc(r.label)}</span><span class="sub">${esc(r.sub)}</span></div>`;
  }).join("") : `<div class="gs-empty">Ничего не нашлось — попробуйте номер модели (например «12-196»), завод или станцию депо</div>`;
  box.hidden = false;
}
function hideSearchSuggest() { const b = $("search-suggest"); if (b) b.hidden = true; }
function goSearch(href) { $("search").value = ""; hideSearchSuggest(); $("search").blur(); nav(href); }
function wireGlobalSearch() {
  const input = $("search");
  input.addEventListener("input", renderSearchSuggest);
  input.addEventListener("focus", renderSearchSuggest);
  input.addEventListener("blur", () => setTimeout(hideSearchSuggest, 120));
  input.addEventListener("keydown", e => {
    const items = [...$("search-suggest").querySelectorAll(".gs-item")];
    if (e.key === "Escape") { hideSearchSuggest(); return; }
    if (!items.length) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      gsHi = Math.max(0, Math.min(items.length - 1, gsHi + (e.key === "ArrowDown" ? 1 : -1)));
      items.forEach((el, i) => el.classList.toggle("hi", i === gsHi));
    } else if (e.key === "Enter") { e.preventDefault(); goSearch(items[gsHi].dataset.href); }
  });
}

/* ============================================================
   Главная
   ============================================================ */
function renderHub() {
  const tiles = [
    ["Чем везти?", "#/catalog", "Грузовые вагоны<br>российского производства", `<svg viewBox="0 0 64 44" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 12h56v20H4z"/><path d="M13 12v20M22 12v20M31 12v20M40 12v20M49 12v20" stroke-width="1" opacity=".5"/><circle cx="15" cy="36" r="3.6"/><circle cx="24" cy="36" r="3.6"/><circle cx="40" cy="36" r="3.6"/><circle cx="49" cy="36" r="3.6"/><path d="M1 41h62" stroke-width="1.2"/></svg>`, `${VAGONS.length} моделей`],
    ["Кто производит?", "#/mfrs", "Вагоностроительные<br>предприятия России", `<svg viewBox="0 0 64 44" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 40V22l12 7v-7l12 7v-7l12 7V10h8v6h6v24z"/><path d="M2 40h60"/><path d="M14 34h4M26 34h4M38 34h4M50 30h4M50 35h4" stroke-width="1.2"/><path d="M44 10V5h4v5" stroke-width="1.2"/></svg>`, `${mainMfrs().length} предприятий`],
    ["Что везти?", "#/cargo", "Перечень грузов<br>для перевозки", `<svg viewBox="0 0 64 44" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M32 4 12 14l20 10 20-10z"/><path d="M12 14v16l20 10 20-10V14"/><path d="M32 24v16"/><path d="m22 9 20 10" stroke-width="1.1" opacity=".6"/></svg>`, `${fmtNum(DATA.cargoTypes.length)} грузов`],
    ["Где ремонтировать?", "#/depots", "Ремонтные депо", `<svg viewBox="0 0 64 44" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M32 41s12-11 12-20a12 12 0 0 0-24 0c0 9 12 20 12 20z"/><circle cx="32" cy="21" r="4.5"/><path d="M6 41h52" stroke-width="1.2"/><path d="M10 41l4-9M54 41l-4-9" stroke-width="1" opacity=".55"/></svg>`, `${DATA.depots.length} депо`],
    ["Чем ремонтировать?", "#/parts", "Запасные части<br>и комплектующие", `<svg viewBox="0 0 64 44" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="18" cy="26" r="11"/><circle cx="46" cy="26" r="11"/><circle cx="18" cy="26" r="3"/><circle cx="46" cy="26" r="3"/><path d="M21 26h22" stroke-width="3"/><path d="M8 26h-5M56 26h5" stroke-width="2.4"/></svg>`, `${DATA.bogies.length} тележек`],
  ];
  $("view-hub").innerHTML = `<div class="wrap hub">
    <div class="hub-hero">
      <div class="eyebrow" style="color:var(--accent)">Вагонотека</div>
      <h1 class="display">Всё о грузовом вагоне — в одном месте</h1>
      <p>Характеристики, заводы, грузы, депо и запчасти — без беготни по справочникам. С чего начнём?</p>
      <div class="rail-rule" style="max-width:520px;margin:18px auto 0"></div>
    </div>
    <div class="hub-grid">
      ${tiles.map(([q, href, cap, svg, cnt], i) => `<a class="hub-tile${i % 2 ? " alt" : ""}" href="${href}">
        <h3>${q}</h3>
        <div class="hub-card">${svg}<span class="count">${cnt}</span></div>
        <div class="cap">${cap}</div>
      </a>`).join("")}
    </div>
  </div>`;
}
