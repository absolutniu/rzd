/* ============================================================
   Ремонтные депо: #/depots, #/depots/model/W002, #/depot/D001
   ============================================================ */
const depState = { model: null, railways: new Set(), holdings: new Set(), repairs: new Set(), services: new Set(), selected: null };
const PLANNED = new Set(["RT001", "RT002"]); // деповской / капитальный; остальные (ТР-1..3) — текущий ремонт

/* депо, которые ремонтируют модель: прямая авторизация на модель, иначе — компетенция по типу/роду */
function depotsForVagon(v) {
  const depots = new Map();
  const add = (id, rt) => { if (!depots.has(id)) depots.set(id, new Set()); depots.get(id).add(rt); };
  const direct = DATA.depotAuthorizations.filter(a => a.vagon_id === v.id);
  if (direct.length) { direct.forEach(a => add(a.depot_id, a.repair_type_id)); return { mode: "direct", depots }; }
  DATA.depotCompetencies.forEach(c => {
    if (c.vagon_type_id !== v.typeId) return;
    if (c.vagon_kind_id && c.vagon_kind_id !== v.kindId) return;
    add(c.depot_id, c.repair_type_id);
  });
  return { mode: "competency", depots };
}
function depotRepairTypes(id) {
  const s = new Set();
  DATA.depotCompetencies.forEach(c => { if (c.depot_id === id) s.add(c.repair_type_id); });
  DATA.depotAuthorizations.forEach(a => { if (a.depot_id === id) s.add(a.repair_type_id); });
  return s;
}
const depotServices = id => DATA.depotServiceLinks.filter(l => l.depot_id === id);

function filteredDepots() {
  const v = depState.model ? VAGON_BY_ID.get(depState.model) : null;
  const forModel = v ? depotsForVagon(v).depots : null;
  return DATA.depots.filter(d => {
    if (forModel && !forModel.has(d.id)) return false;
    if (depState.railways.size && !depState.railways.has(d.railway_id)) return false;
    if (depState.holdings.size && !depState.holdings.has(d.holding_id)) return false;
    if (depState.repairs.size) {
      const rts = forModel ? forModel.get(d.id) : depotRepairTypes(d.id);
      if (![...depState.repairs].some(rt => rts.has(rt))) return false;
    }
    if (depState.services.size && !depotServices(d.id).some(l => depState.services.has(l.service_id))) return false;
    return true;
  });
}

function renderDepotsRoute(params) {
  const name = location.hash.replace(/^#\/?/, "").split("/")[0];
  if (name === "depot") depState.selected = DEPOT_BY_ID.has(params[0]) ? params[0] : null;
  else if (params[0] === "model") { depState.model = VAGON_BY_ID.has(params[1]) ? params[1] : null; depState.selected = null; }
  else { depState.selected = null; }
  renderDepots();
}
const depotHash = () => depState.model ? `#/depots/model/${depState.model}` : "#/depots";

/* ---------- карта ---------- */
const RUSSIA_OUTLINE = [[112.12,73.79,113.02,73.98,113.53,73.34,113.97,73.59,115.57,73.75,118.78,73.59,119.02,73.12,123.2,72.97,123.26,73.74,126.98,73.57,128.59,73.04,129.05,72.4,128.46,71.98,129.72,71.19,131.29,70.79,132.25,71.84,133.86,71.39,135.56,71.66,137.5,71.35,138.23,71.63,139.87,71.49,139.15,72.42,140.47,72.85,146.0,72.45,146.0,59.31,142.2,59.04,135.13,54.73,136.7,54.6,137.19,53.98,138.16,53.76,138.8,54.25,139.9,54.19,141.35,53.09,141.38,52.24,140.6,51.24,140.06,48.45,138.55,47.0,138.22,46.31,134.87,43.4,133.54,42.81,132.91,42.8,132.28,43.28,130.94,42.55,130.78,42.22,130.64,42.4,130.63,42.9,131.14,42.93,131.29,44.11,131.03,44.97,131.88,45.32,133.1,45.14,133.77,46.12,134.11,47.21,135.03,48.48,133.37,48.18,132.51,47.79,130.99,47.79,130.58,48.73,129.4,49.44,127.66,49.76,127.29,50.74,125.95,52.79,123.57,53.46,121.0,53.25,120.18,52.75,120.73,52.52,120.74,51.96,119.28,50.58,119.29,50.14,117.88,49.51,116.68,49.89,115.49,49.81,114.36,50.25,112.9,49.54,110.66,49.13,108.48,49.28,106.89,50.27,105.89,50.41,103.68,50.09,102.26,50.51,102.07,51.26,98.86,52.05,97.83,51.01,98.23,50.42,97.26,49.73,94.82,50.01,94.15,50.48,93.1,50.5,92.23,50.8,88.81,49.47,87.36,49.21,86.83,49.83,85.54,49.69,83.38,51.07,81.95,50.81,80.57,51.39,80.04,50.86,77.8,53.4,76.53,54.18,76.89,54.49,74.38,53.55,73.43,53.49,73.51,54.04,72.22,54.38,71.18,54.13,70.87,55.17,69.07,55.39,68.17,54.97,65.18,54.35,61.44,54.01,60.98,53.66,61.7,52.98,60.74,52.72,60.93,52.45,59.97,51.96,61.59,51.27,61.34,50.8,59.93,50.84,59.64,50.55,58.36,51.06,56.78,51.04,55.72,50.62,52.33,51.72,50.77,51.69,48.7,50.61,48.58,49.87,47.55,50.45,46.75,49.36,47.04,49.15,46.47,48.39,47.32,47.72,48.06,47.74,48.69,47.08,48.59,46.56,49.1,46.4,48.65,45.81,47.68,45.64,46.68,44.61,47.59,43.66,47.49,42.99,48.58,41.81,47.82,41.15,45.78,42.09,45.47,42.5,44.54,42.71,43.93,42.55,42.39,43.22,39.96,43.43,36.68,45.24,37.4,45.4,38.23,46.24,37.67,46.64,39.15,47.04,39.12,47.26,38.22,47.1,38.26,47.55,38.77,47.83,39.74,47.9,39.9,48.23,39.67,48.78,40.07,49.6,38.01,49.92,37.39,50.38,36.63,50.23,35.36,50.58,35.02,51.21,34.22,51.26,34.14,51.57,34.39,51.77,33.75,52.34,31.79,52.1,31.31,53.07,32.69,53.35,31.73,53.79,31.79,53.97,30.76,54.81,30.97,55.08,30.87,55.55,29.9,55.79,29.37,55.67,29.23,55.92,28.18,56.17,27.77,57.24,27.29,57.47,27.72,57.79,27.42,58.72,28.13,59.3,27.98,59.48,29.12,60.03,28.07,60.5,31.14,62.36,31.52,62.87,30.04,63.55,30.44,64.2,29.54,64.95,30.22,65.81,29.05,66.94,29.98,67.7,28.45,68.36,28.59,69.06,32.13,69.91,33.78,69.3,36.51,69.06,40.29,67.93,41.06,67.46,41.13,66.79,40.02,66.27,38.38,66.0,33.92,66.76,33.18,66.63,34.81,65.9,34.94,64.41,37.01,63.85,37.14,64.33,36.54,64.76,37.18,65.14,39.59,64.52,40.44,64.76,39.76,65.5,42.09,66.48,43.95,66.07,44.53,66.76,43.7,67.35,44.19,67.95,43.45,68.57,46.25,68.25,46.82,67.69,45.56,67.57,45.56,67.01,46.35,66.67,47.89,66.88,48.14,67.52,53.72,68.86,54.47,68.81,53.49,68.2,54.73,68.1,55.44,68.44,57.32,68.47,58.8,68.88,59.94,68.28,61.08,68.94,60.03,69.52,60.55,69.85,63.5,69.55,68.51,68.09,69.18,68.62,68.16,69.14,68.14,69.36,66.93,69.45,67.26,69.93,66.69,71.03,68.54,71.93,69.2,72.84,69.94,73.04,72.59,72.78,72.8,72.22,71.85,71.41,72.47,71.09,72.79,70.39,72.56,69.02,73.67,68.41,73.24,67.74,71.28,66.32,72.42,66.17,72.82,66.53,73.92,66.79,74.19,67.28,75.05,67.76,74.47,68.33,74.94,68.99,73.84,69.07,73.6,69.63,74.4,70.63,73.1,71.45,74.89,72.12,74.66,72.83,75.16,72.85,75.68,72.3,75.29,71.34,76.36,71.15,75.9,71.87,77.58,72.27,79.65,72.32,81.5,71.75,80.61,72.58,80.51,73.65,82.25,73.85,110.87,74.0],[57.54,70.72,53.68,70.76,53.41,71.21,51.6,71.47,51.46,72.01,52.48,72.23,52.44,72.77,54.43,73.63,53.51,73.75,54.19,74.0,58.01,74.0,55.42,72.37,55.62,71.54],[144.65,48.98,143.17,49.31,142.56,47.86,143.53,46.84,143.51,46.14,142.75,46.74,142.09,45.97,141.9,48.86,142.18,50.95,141.59,51.94,141.68,53.3,142.61,53.76,142.21,54.23,142.65,54.37,143.26,52.74,143.24,51.76],[22.73,54.33,19.66,54.43,19.89,54.87,21.27,55.19,22.76,54.86],[143.6,73.21,140.04,73.32,139.86,73.37,140.81,73.77,142.06,73.86,143.48,73.48]];
// фиксированные геограницы — те же, по которым обрезан RUSSIA_OUTLINE (db/build_map_outline.py)
const MAP = (() => {
  const LON_MIN = 18, LON_MAX = 146, LAT_MIN = 40, LAT_MAX = 74, W = 640, H = 360, PAD = 20;
  const xCorr = Math.cos((LAT_MIN + LAT_MAX) / 2 * Math.PI / 180);
  const geoW = (LON_MAX - LON_MIN) * xCorr, geoH = LAT_MAX - LAT_MIN;
  const scale = Math.min((W - 2 * PAD) / geoW, (H - 2 * PAD) / geoH);
  const left = PAD + ((W - 2 * PAD) - geoW * scale) / 2, top = PAD + ((H - 2 * PAD) - geoH * scale) / 2;
  const x = lon => left + (lon - LON_MIN) * xCorr * scale, y = lat => top + (LAT_MAX - lat) * scale;
  const land = RUSSIA_OUTLINE.map(r => { let d = ""; for (let i = 0; i < r.length; i += 2) d += (i ? "L" : "M") + x(r[i]).toFixed(1) + " " + y(r[i + 1]).toFixed(1); return d + "Z"; }).join(" ");
  return { W, H, x, y, land };
})();
const holdingColor = id => `var(--map-${(DATA.repairHoldings.findIndex(h => h.id === id) % 3) + 1})`;
function depotMapHTML(visible) {
  const dots = DATA.depots.filter(d => d.latitude != null && d.longitude != null).map(d =>
    `<circle class="dot${visible.has(d.id) ? "" : " hidden"}${depState.selected === d.id ? " sel" : ""}" data-id="${d.id}" cx="${MAP.x(d.longitude).toFixed(1)}" cy="${MAP.y(d.latitude).toFixed(1)}" r="3.8" style="--dot:${holdingColor(d.holding_id)}" tabindex="0" role="button" aria-label="${esc(d.name)}"></circle>`).join("");
  return `<div class="depot-map-frame">
    <svg id="depot-map" viewBox="0 0 ${MAP.W} ${MAP.H}" preserveAspectRatio="xMidYMid meet"><path class="land" d="${MAP.land}" fill-rule="evenodd"/>${dots}</svg>
    <div class="depot-map-tip" id="depot-map-tip"></div>
    <div class="depot-map-legend">${DATA.repairHoldings.map(h => `<span class="map-legend-item"><span class="sw" style="background:${holdingColor(h.id)}"></span>${esc(h.short_name)}</span>`).join("")}</div>
  </div>`;
}
function wireDepotMap() {
  const svg = $("depot-map"), tip = $("depot-map-tip");
  if (!svg) return;
  const show = dot => {
    const r = svg.getBoundingClientRect();
    tip.textContent = DEPOT_BY_ID.get(dot.dataset.id).name;
    tip.style.left = (r.width * dot.cx.baseVal.value / MAP.W) + "px";
    tip.style.top = (r.height * dot.cy.baseVal.value / MAP.H) + "px";
    tip.classList.add("show");
  };
  svg.querySelectorAll(".dot").forEach(dot => {
    dot.addEventListener("mouseenter", () => show(dot));
    dot.addEventListener("focus", () => show(dot));
    dot.addEventListener("mouseleave", () => { if (dot.dataset.id !== depState.selected) tip.classList.remove("show"); else show(dot); });
    dot.addEventListener("click", () => nav(`#/depot/${dot.dataset.id}`));
  });
  const sel = depState.selected && svg.querySelector(`.dot[data-id="${depState.selected}"]`);
  if (sel) { sel.parentNode.appendChild(sel); show(sel); }
}

/* ---------- панель депо ---------- */
function depotPanelHTML(d) {
  const holding = d.holding_id ? HOLDING_BY_ID.get(d.holding_id) : null;
  const railway = d.railway_id ? RAILWAY_BY_ID.get(d.railway_id) : null;
  const coords = (d.latitude && d.longitude) ? `<a href="https://yandex.ru/maps/?pt=${d.longitude},${d.latitude}&z=13" target="_blank" rel="noopener noreferrer" style="color:var(--accent)">${d.latitude.toFixed(4)}, ${d.longitude.toFixed(4)} — открыть на карте</a>` : "—";
  const comps = DATA.depotCompetencies.filter(c => c.depot_id === d.id);
  const groups = new Map();
  comps.filter(c => PLANNED.has(c.repair_type_id)).forEach(c => {
    const k = `${c.vagon_type_id}|${c.vagon_kind_id || ""}`;
    if (!groups.has(k)) groups.set(k, { t: c.vagon_type_id, kind: c.vagon_kind_id, rts: new Map() });
    groups.get(k).rts.set(c.repair_type_id, c.note);
  });
  const planned = [...groups.values()].sort((a, b) => a.t.localeCompare(b.t) || (a.kind || "").localeCompare(b.kind || ""));
  const rtChip = (rt, note) => `<span class="tag-chip">${esc(REPAIR_TYPE_BY_ID.get(rt) || rt)}${note ? `<span class="note-dot" title="${esc(note)}">?</span>` : ""}</span>`;
  const current = [...new Set(comps.filter(c => !PLANNED.has(c.repair_type_id)).map(c => c.repair_type_id))];
  const auths = DATA.depotAuthorizations.filter(a => a.depot_id === d.id);
  const authByVagon = new Map();
  auths.forEach(a => { if (!authByVagon.has(a.vagon_id)) authByVagon.set(a.vagon_id, new Map()); authByVagon.get(a.vagon_id).set(a.repair_type_id, a.note); });
  const services = depotServices(d.id);
  const dContacts = DATA.depotContacts[d.id] || [];
  const hContacts = holding ? (DATA.repairHoldingContacts[holding.id] || []) : [];
  const contactList = list => list.map(c => `<div class="mfr-sub">${esc(c.name || "")}</div>${c.phone ? `<div>${esc(c.phone)}</div>` : ""}${c.email ? `<div><a href="mailto:${esc(c.email.split(/[,;]/)[0].trim())}">${esc(c.email)}</a></div>` : ""}`).join("");
  const typeLbl = (t, kind) => `<span class="lbl">${esc(TYPE_META[t]?.name || t)}${kind ? `<span class="k">${esc(KIND_BY_ID.get(kind)?.name || "")}</span>` : ""}</span>`;

  return `<div class="depot-panel" id="depot-panel">
    <button class="close" title="Закрыть" onclick="nav(depotHash())">✕</button>
    <div class="dp-head">
      <div>
        <div class="eyebrow">Депо</div>
        <h2>${esc(d.name)}</h2>
        ${d.website ? siteLink(d.website) : ""}
        <div class="field-label" style="margin-top:16px">Ремонтный холдинг</div>
        ${holding ? `<span class="tag-chip alt">${esc(holding.short_name || holding.full_name)}</span>` : `<span class="no-data">не указан</span>`}
      </div>
      <div>
        <div class="eyebrow" style="margin-bottom:6px">Общие</div>
        <dl class="spec-table">
          <div class="row"><dt>Дорога</dt><dd>${esc(railway || "—")}</dd></div>
          <div class="row"><dt>Станция примыкания</dt><dd>${esc(d.adjoining_station || "—")}</dd></div>
          <div class="row"><dt>Код станции</dt><dd>${esc(d.station_code || "—")}</dd></div>
          <div class="row"><dt>Клеймо депо</dt><dd>${esc(d.stamp_code || "—")}</dd></div>
          <div class="row"><dt>Координаты</dt><dd>${coords}</dd></div>
          ${d.inn ? `<div class="row"><dt>ИНН</dt><dd>${esc(d.inn)}</dd></div>` : ""}
          ${d.address ? `<div class="row"><dt>Адрес</dt><dd style="font-family:inherit;text-align:left">${esc(d.address)}</dd></div>` : ""}
          ${d.registration_date ? `<div class="row"><dt>Дата регистрации</dt><dd>${fmtDate(d.registration_date)}</dd></div>` : ""}
        </dl>
      </div>
    </div>

    <div class="dp-section"><h4>Компетенции по ремонту <span class="sm">(типовые вагоны)</span></h4></div>
    <div class="dp-section"><h4>Плановые ремонты</h4>
      ${planned.length ? `<div class="dp-box">${planned.map(g => `<div class="comp-row">${typeLbl(g.t, g.kind)}<span class="chips">${[...g.rts].map(([rt, n]) => rtChip(rt, n)).join("")}</span></div>`).join("")}</div>` : `<p class="no-data">не внесены</p>`}
    </div>
    <div class="dp-section"><h4>Текущий ремонт</h4>
      ${current.length ? `<div class="dp-box" style="padding:10px 12px"><div class="tags">${current.map(rt => `<span class="tag-chip alt big" style="font-size:14px">${esc(REPAIR_TYPE_BY_ID.get(rt) || rt)}</span>`).join("")}</div></div>` : `<p class="no-data">данных о текущем ремонте (ТР-1, ТР-2, ТР-3) пока нет</p>`}
    </div>
    <div class="dp-section"><h4>Авторизация на ремонт <span class="sm">(вагоны с повышенной осевой нагрузкой)</span></h4>
      ${authByVagon.size ? `<div class="dp-box">${[...authByVagon].map(([vid, rts]) => { const v = VAGON_BY_ID.get(vid); if (!v) return "";
        return `<div class="comp-row">${typeLbl(v.typeId, v.kindId)}<span class="chips"><a class="tag-chip alt link" href="#/vagon/${v.id}">${esc(v.model)}</a>${[...rts].map(([rt, n]) => rtChip(rt, n)).join("")}</span></div>`; }).join("")}</div>`
        : `<p class="no-data">авторизаций на конкретные модели нет</p>`}
    </div>
    <div class="dp-section"><h4>Дополнительные услуги</h4>
      ${services.length ? `<div class="dp-box" style="padding:10px 12px"><div class="tags">${services.map(l => `<span class="tag-chip alt">${esc(SERVICE_BY_ID.get(l.service_id) || l.service_id)}${l.note ? `<span class="note-dot" title="${esc(l.note)}">?</span>` : ""}</span>`).join("")}</div></div>` : `<p class="no-data">не внесены</p>`}
    </div>
    <div class="contact-boxes">
      <div class="contact-box"><h5>Контакты депо</h5>${dContacts.length ? contactList(dContacts) : `<span class="no-data">не внесены</span>`}</div>
      <div class="contact-box"><h5>Контакты холдинга</h5>${holding ? `<div style="font-weight:700">${esc(holding.short_name || "")} ${holding.website ? siteLink(holding.website) : ""}</div>${contactList(hContacts)}` : `<span class="no-data">—</span>`}</div>
    </div>
  </div>`;
}

/* ---------- страница ---------- */
function renderDepots() {
  const list = filteredDepots();
  const visible = new Set(list.map(d => d.id));
  const v = depState.model ? VAGON_BY_ID.get(depState.model) : null;
  SUGGEST.depmodel = { source: vagonSource, pick: id => nav(`#/depots/model/${id}`) };
  const railOpts = [...new Set(DATA.depots.map(d => d.railway_id).filter(Boolean))].map(id => ({ value: id, label: RAILWAY_BY_ID.get(id), count: DATA.depots.filter(d => d.railway_id === id).length }))
    .sort((a, b) => a.label.localeCompare(b.label, "ru"));
  const multi = (label, opts, key) => ({ kind: "multi", label, opts, get: () => depState[key], set: s => { depState[key] = new Set(s); renderDepots(); } });
  const applied = [];
  if (depState.railways.size) applied.push({ k: "Дорога", v: [...depState.railways].map(id => RAILWAY_BY_ID.get(id)), remove: "depState.railways.clear(); renderDepots()" });
  if (depState.holdings.size) applied.push({ k: "Ремонтный холдинг", v: [...depState.holdings].map(id => HOLDING_BY_ID.get(id)?.short_name), remove: "depState.holdings.clear(); renderDepots()" });
  if (depState.repairs.size) applied.push({ k: "Тип ремонта", v: [...depState.repairs].map(id => REPAIR_TYPE_BY_ID.get(id)), remove: "depState.repairs.clear(); renderDepots()" });
  if (depState.services.size) applied.push({ k: "Дополнительные услуги", v: [...depState.services].map(id => SERVICE_BY_ID.get(id)), remove: "depState.services.clear(); renderDepots()" });
  const sel = depState.selected ? DEPOT_BY_ID.get(depState.selected) : null;
  const rows = list.slice().sort((a, b) => (a.railway_id || "").localeCompare(b.railway_id || "") || a.name.localeCompare(b.name, "ru"));

  $("view-depots").innerHTML = bandHTML("Ремонтные депо") + `<div class="wrap">
    ${crumbsHTML([["Главная", "#/"], ["Ремонтные депо", (v || sel) ? "#/depots" : null], ...(sel ? [[sel.name, null]] : v ? [["модель " + v.model, null]] : [])])}
    <div class="layout-3">
      <aside class="sticky-side">
        <div class="panel"><div class="panel-title center">Поиск депо по<br>модели вагона</div>
          <label class="field-label" for="si-depmodel">Модель вагона</label>
          ${v ? `<div style="margin-bottom:8px">${chipHTML(v.model, "depState.model=null; nav('#/depots')")}</div>` : ""}
          ${suggestInputHTML("depmodel", "например, 12-196-02")}
          ${v ? `<p class="caption" style="font-size:12px;margin-top:10px">${depotsForVagon(v).mode === "direct" ? "Депо, авторизованные на ремонт этой модели." : `Депо с компетенцией по роду «${esc(kindName(v) || TYPE_META[v.typeId].name)}».`} <a href="#/vagon/${v.id}">Карточка модели</a></p>` : ""}
        </div>
      </aside>
      <div>
        ${v ? `<div class="cat-head cargo"><h2>Найдено для модели</h2>${chipHTML(v.model, "depState.model=null; nav('#/depots')", "lg")}</div>` : ""}
        <div class="toolbar">
          ${ddHTML("dep-rw", multi("Дорога", railOpts, "railways"))}
          ${ddHTML("dep-h", multi("Ремонтный холдинг", DATA.repairHoldings.map(h => ({ value: h.id, label: h.short_name, count: DATA.depots.filter(d => d.holding_id === h.id).length })), "holdings"))}
          ${ddHTML("dep-rt", multi("Тип ремонта", DATA.repairTypes.map(r => ({ value: r.id, label: r.name, count: DATA.depots.filter(d => depotRepairTypes(d.id).has(r.id)).length })), "repairs"))}
          ${ddHTML("dep-sv", multi("Дополнительные услуги", DATA.depotServices.map(s => ({ value: s.id, label: s.name, count: DATA.depots.filter(d => depotServices(d.id).some(l => l.service_id === s.id)).length })), "services"))}
        </div>
        ${depotMapHTML(visible)}
      </div>
      <aside class="sticky-side rail-right">${appliedHTML(applied, "depState.railways.clear(); depState.holdings.clear(); depState.repairs.clear(); depState.services.clear(); renderDepots()")}</aside>
      <div class="span-cr">
        <div class="depot-count">${list.length === DATA.depots.length ? `всего добавлено: <b>${pl(list.length, "депо", "депо", "депо")}</b>` : `найдено: <b>${pl(list.length, "депо", "депо", "депо")}</b>`}</div>
        <div class="depot-split${sel ? "" : " single"}">
          <div class="depot-table-wrap"><table class="depot-table">
            <thead><tr><th>Дорога</th><th>Холдинг</th><th>Депо</th><th></th></tr></thead>
            <tbody>${rows.map(d => `<tr class="${d.id === depState.selected ? "sel" : ""}" onclick="nav('${d.id === depState.selected ? depotHash() : "#/depot/" + d.id}')">
              <td>${esc(RAILWAY_BY_ID.get(d.railway_id) || "—")}</td><td>${esc(HOLDING_BY_ID.get(d.holding_id)?.short_name || "—")}</td>
              <td class="name">${esc(d.name)}</td><td class="more">${d.id === depState.selected ? "✕" : "подробнее"}</td></tr>`).join("") || `<tr><td colspan="4" class="empty-state">Нет депо с такими параметрами</td></tr>`}</tbody>
          </table></div>
          ${sel ? depotPanelHTML(sel) : ""}
        </div>
      </div>
    </div>
  </div>`;
  wireDepotMap();
  if (sel && route.lastGroup === "depots") $("depot-panel")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
