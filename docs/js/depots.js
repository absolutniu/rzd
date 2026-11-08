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
const stampOff = d => d.stamp_status && d.stamp_status !== "Действует"; // клеймо прекращено/приостановлено (реестр РС ФЖТ)

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

/* ---------- карта: MapLibre + слои ж/д сети из railmap/ (db/build_railmap.py) ---------- */
const holdingColor = id => `var(--map-${(DATA.repairHoldings.findIndex(h => h.id === id) % 6) + 1})`;
// значок на карте (лист «Депо_Характер», описание — «Справочник_ID»)
const MAP_ICONS = [["●", "вагоноремонтное депо / завод"], ["◆", "вагонный участок / участок ТОР / ВКМ / колесно-роликовый участок"]];
const MAPLIBRE = "vendor/maplibre-gl-4.7.1/maplibre-gl";  // своя копия, без внешних CDN
const RAILMAP_VIEW = [[19, 41], [145, 71]];
// карта живёт дольше страницы: renderDepots() перерисовывает HTML, а этот узел переносится в новый слот
const RM = { map: null, el: null, loading: null, meta: null, visible: new Set(), fitKey: "", selected: null, popup: null };

function loadMapLibre() {  // ~800 КБ — грузим, только когда открыли «Ремонтные депо»
  if (window.maplibregl) return Promise.resolve();
  RM.loading ||= new Promise((ok, fail) => {
    const css = document.createElement("link");
    css.rel = "stylesheet"; css.href = MAPLIBRE + ".css";
    const js = document.createElement("script");
    js.src = MAPLIBRE + ".js"; js.onload = ok; js.onerror = fail;
    document.head.append(css, js);
  });
  return RM.loading;
}

function depotMapHTML() {
  return `<div class="depot-map-frame">
    <div class="depot-map-slot" id="depot-map-slot"></div>
    <div class="depot-map-legend">${DATA.repairHoldings.map(h => `<span class="map-legend-item"><span class="sw" style="background:${holdingColor(h.id)}"></span>${esc(h.short_name)}</span>`).join("")}</div>
    <div class="depot-map-legend icons">${MAP_ICONS.map(([icon, label]) => `<span class="map-legend-item"><span class="ic">${icon}</span>${esc(label)}</span>`).join("")}
      <a class="map-legend-item" href="railmap/" style="margin-left:auto;color:var(--accent)">Карта ж/д сети →</a></div>
  </div>`;
}

function wireDepotMap(visible) {
  const slot = $("depot-map-slot");
  if (!slot) return;
  RM.visible = visible;
  if (!RM.el) { RM.el = document.createElement("div"); RM.el.className = "depot-map"; }
  slot.appendChild(RM.el);
  if (RM.map) { RM.map.resize(); updateDepotMap(); return; }
  loadMapLibre().then(initDepotMap).catch(() => {
    RM.el.innerHTML = `<p class="no-data" style="padding:24px">Карта не загрузилась — проверьте подключение к интернету.</p>`;
  });
}

function depotFeatures() {
  return { type: "FeatureCollection", features: DATA.depots.filter(d => d.latitude != null && d.longitude != null).map(d => ({
    type: "Feature", geometry: { type: "Point", coordinates: [d.longitude, d.latitude] },
    properties: { id: d.id, name: d.name, dia: d.map_icon === "◆", color: cssVar(holdingColor(d.holding_id).slice(4, -1)) },
  })) };
}
const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

async function initDepotMap() {
  if (RM.map) return;
  const get = f => fetch("railmap/" + f, { cache: "no-cache" }).then(r => r.json());
  const [meta, land, neighbors, roads, lines, stations, junctions] = await Promise.all(
    ["meta.json", "land.geojson", "neighbors.geojson", "roads.geojson", "lines.geojson", "stations.geojson", "junctions.geojson"].map(get));
  RM.meta = meta; RM.stations = stations.features; RM.junctions = junctions.features;
  // код дороги на карте (ОКТ, МСК…) <-> railway_id сайта — по названию; у БЧ, КЗХ, КЛГ депо нет
  RM.railwayByCode = new Map(Object.entries(meta.roads).map(([code, name]) => [code, DATA.railways.find(r => r.name.trim() === name)?.id]).filter(([, id]) => id));
  RM.codeByRailway = new Map([...RM.railwayByCode].map(([code, id]) => [id, code]));
  const c = n => cssVar("--rm-" + n);
  const map = RM.map = new maplibregl.Map({
    container: RM.el, attributionControl: false, bounds: RAILMAP_VIEW, fitBoundsOptions: { padding: 20 },
    maxBounds: [[-5, 28], [200, 84]], cooperativeGestures: true, dragRotate: false, pitchWithRotate: false,
    locale: {
      "CooperativeGesturesHandler.WindowsHelpText": "Масштаб — Ctrl + колесо мыши",
      "CooperativeGesturesHandler.MacHelpText": "Масштаб — ⌘ + колесо мыши",
      "CooperativeGesturesHandler.MobileHelpText": "Карту двигают двумя пальцами",
      "NavigationControl.ZoomIn": "Приблизить", "NavigationControl.ZoomOut": "Отдалить",
    },
    style: { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": c("bg") } }],
             glyphs: new URL("vendor/fonts/{fontstack}/{range}.pbf", document.baseURI).href.replace(/%7B/g, "{").replace(/%7D/g, "}") },
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
  map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: "© участники OpenStreetMap · Natural Earth" }));
  map.on("load", () => {
    for (const [id, data] of Object.entries({ land, neighbors, roads, lines, stations, junctions, depots: depotFeatures() })) map.addSource(id, { type: "geojson", data });
    map.addLayer({ id: "neighbors", type: "fill", source: "neighbors", paint: { "fill-color": c("neighbor") } });
    map.addLayer({ id: "land", type: "fill", source: "land", paint: { "fill-color": c("land") } });
    map.addLayer({ id: "roads-fill", type: "fill", source: "roads", paint: { "fill-color": c("road") } });
    map.addLayer({ id: "roads-edge", type: "line", source: "roads", paint: { "line-color": c("edge"), "line-width": 1 } });
    map.addLayer({ id: "track-branch", type: "line", source: "lines", filter: ["==", ["get", "usage"], "branch"],
      paint: { "line-color": c("track"), "line-width": ["interpolate", ["linear"], ["zoom"], 3, .6, 9, 2.2] } });
    map.addLayer({ id: "track-main", type: "line", source: "lines", filter: ["==", ["get", "usage"], "main"], layout: { "line-join": "round" },
      paint: { "line-color": c("track"), "line-width": ["interpolate", ["linear"], ["zoom"], 3, 1.1, 9, 3.6] } });
    map.addLayer({ id: "stations", type: "circle", source: "stations", minzoom: 7,
      paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 7, 2, 11, 4], "circle-color": c("edge"), "circle-stroke-color": c("track"), "circle-stroke-width": 1 } });
    // ромбик участка — картинка: квадрат, повёрнутый на 45°
    const s = 24, cv = document.createElement("canvas"), g = cv.getContext("2d");
    cv.width = cv.height = s; g.translate(s / 2, s / 2); g.rotate(Math.PI / 4); g.fillStyle = "#fff"; g.fillRect(-7, -7, 14, 14);
    map.addImage("dia", g.getImageData(0, 0, s, s), { sdf: true });
    map.addLayer({ id: "depot-sel", type: "circle", source: "depots", filter: ["==", ["get", "id"], ""],
      paint: { "circle-radius": 11, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": c("sel"), "circle-stroke-width": 2.5 } });
    map.addLayer({ id: "depots", type: "circle", source: "depots", filter: ["!", ["get", "dia"]],
      paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 3.6, 9, 7], "circle-color": ["get", "color"], "circle-stroke-color": c("track"), "circle-stroke-width": 1.2 } });
    map.addLayer({ id: "depots-dia", type: "symbol", source: "depots", filter: ["get", "dia"],
      layout: { "icon-image": "dia", "icon-size": ["interpolate", ["linear"], ["zoom"], 3, .55, 9, 1], "icon-allow-overlap": true },
      paint: { "icon-color": ["get", "color"], "icon-halo-color": c("track"), "icon-halo-width": 1.2 } });
    // переходы на соседние дороги — когда в фильтре одна дорога; клик — фильтр на соседнюю
    map.addLayer({ id: "junctions", type: "circle", source: "junctions", filter: ["==", ["get", "road"], ""],
      paint: { "circle-radius": 7, "circle-color": c("edge"), "circle-stroke-color": c("track"), "circle-stroke-width": 2.5 } });
    map.addLayer({ id: "junction-label", type: "symbol", source: "junctions", filter: ["==", ["get", "road"], ""],
      layout: { "text-field": ["concat", ["get", "to_name"], " ЖД"], "text-font": ["Open Sans Semibold"], "text-size": 12.5,
                "text-variable-anchor": ["bottom", "top", "left", "right"], "text-radial-offset": 1.1 },
      paint: { "text-color": cssVar("--ink"), "text-halo-color": c("bg"), "text-halo-width": 2 } });
    RM.popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: "depot-map-tip", offset: 10 });
    for (const l of ["depots", "depots-dia", "stations"]) {
      map.on("mousemove", l, e => {
        const p = e.features[0].properties;
        map.getCanvas().style.cursor = l === "stations" ? "" : "pointer";
        RM.popup.setLngLat(e.features[0].geometry.coordinates).setText(p.esr !== undefined ? `ст. ${p.name}${p.esr ? " · " + p.esr : ""}` : p.name).addTo(map);
      });
      map.on("mouseleave", l, () => { map.getCanvas().style.cursor = ""; RM.popup.remove(); updateDepotMap(); });
    }
    for (const l of ["depots", "depots-dia"])
      map.on("click", l, e => { const id = e.features[0].properties.id; nav(id === depState.selected ? depotHash() : `#/depot/${id}`); });
    for (const l of ["junctions", "junction-label"]) {
      map.on("click", l, e => pickMapRoad(e.features[0].properties.to));
      map.on("mouseenter", l, () => map.getCanvas().style.cursor = "pointer");
      map.on("mouseleave", l, () => map.getCanvas().style.cursor = "");
    }
    map.on("click", "roads-fill", e => {
      if (!map.queryRenderedFeatures(e.point, { layers: ["depots", "depots-dia", "junctions", "junction-label"] }).length) pickMapRoad(e.features[0].properties.road);
    });
    updateDepotMap();
  });
}

// выбор дороги на карте = фильтр «Дорога» с одной этой дорогой
function pickMapRoad(code) {
  const id = RM.railwayByCode.get(code);
  if (!id || (depState.railways.size === 1 && depState.railways.has(id))) return;
  depState.railways = new Set([id]);
  if (depState.selected) nav(depotHash()); else renderDepots();
}

function updateDepotMap() {
  const map = RM.map;
  if (!map || !map.getLayer("depots")) return;
  const ids = [...RM.visible], all = ids.length === DATA.depots.length;
  const shown = ["in", ["get", "id"], ["literal", ids]];
  map.setFilter("depots", ["all", ["!", ["get", "dia"]], shown]);
  map.setFilter("depots-dia", ["all", ["get", "dia"], shown]);
  map.setFilter("depot-sel", ["==", ["get", "id"], depState.selected || ""]);
  // выбраны дороги — их территория и пути ярче, остальные бледнее; одна дорога — крупно, с переходами на соседние
  const codes = [...depState.railways].map(id => RM.codeByRailway.get(id)).filter(Boolean);
  const single = codes.length === 1 ? codes[0] : null;
  const on = codes.length ? ["in", ["get", "road"], ["literal", codes]] : true;
  map.setPaintProperty("roads-fill", "fill-opacity", codes.length ? ["case", on, 1, single ? .18 : .4] : 1);
  map.setPaintProperty("roads-edge", "line-opacity", single ? ["case", on, 1, .25] : 1);
  for (const l of ["track-main", "track-branch"]) map.setPaintProperty(l, "line-opacity", codes.length ? ["case", on, 1, single ? .1 : .35] : 1);
  const jf = single ? ["all", ["==", ["get", "road"], single], ["in", ["get", "to"], ["literal", [...RM.railwayByCode.keys()]]]] : ["==", ["get", "road"], ""];
  map.setFilter("junctions", jf); map.setFilter("junction-label", jf);
  // вид: выбранное депо — к нему; изменился набор депо — показать все найденные
  const sel = depState.selected && DEPOT_BY_ID.get(depState.selected);
  if (sel && sel.latitude != null && RM.selected !== sel.id) {
    map.easeTo({ center: [sel.longitude, sel.latitude], zoom: Math.max(map.getZoom(), 5.5), duration: 600 });
  } else if (!sel) {
    const key = single ? "road:" + single : all ? "" : ids.slice().sort().join();
    if (key !== RM.fitKey) {
      const pts = ids.map(id => DEPOT_BY_ID.get(id)).filter(d => d && d.latitude != null);
      if (single) {  // вся дорога: её станции, депо и переходы
        const xy = [...RM.stations, ...RM.junctions].filter(f => f.properties.road === single).map(f => f.geometry.coordinates)
          .concat(pts.map(d => [d.longitude, d.latitude]));
        const lon = xy.map(p => p[0]), lat = xy.map(p => p[1]);
        map.fitBounds([[Math.min(...lon), Math.min(...lat)], [Math.max(...lon), Math.max(...lat)]], { padding: 50, duration: 600 });
      } else if (!all && pts.length) {
        const lon = pts.map(d => d.longitude), lat = pts.map(d => d.latitude);
        map.fitBounds([[Math.min(...lon), Math.min(...lat)], [Math.max(...lon), Math.max(...lat)]], { padding: 50, maxZoom: 7, duration: 600 });
      } else map.fitBounds(RAILMAP_VIEW, { padding: 20, duration: 600 });
    }
    RM.fitKey = key;
  }
  if (sel) RM.popup.setLngLat([sel.longitude, sel.latitude]).setText(sel.name).addTo(map);
  RM.selected = depState.selected;
}

/* ---------- панель депо ---------- */
// станция примыкания и код станции пока не показываются (в базе и выгрузке остаются: adjoining_station, station_code)
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
          <div class="row"><dt>Клеймо депо</dt><dd>${esc(d.stamp_code || "—")}${stampOff(d) ? ` <span class="stamp-off">клеймо ${esc(d.stamp_status.toLowerCase())}о</span>` : ""}</dd></div>
          ${d.cert_number ? `<div class="row"><dt>Свидетельство РС ФЖТ</dt><dd>${d.cert_url ? `<a href="${esc(d.cert_url)}" target="_blank" rel="noopener noreferrer" style="color:var(--accent)">№ ${esc(d.cert_number)}</a>` : `№ ${esc(d.cert_number)}`}${d.cert_valid_until ? `, до ${fmtDate(d.cert_valid_until)}` : ""}</dd></div>` : ""}
          <div class="row"><dt>Координаты</dt><dd>${coords}</dd></div>
          ${d.inn ? `<div class="row"><dt>ИНН</dt><dd>${esc(d.inn)}</dd></div>` : ""}
          ${d.address ? `<div class="row"><dt>Адрес производства</dt><dd style="font-family:inherit;text-align:left">${esc(d.address)}</dd></div>` : ""}
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
        ${depotMapHTML()}
      </div>
      <aside class="sticky-side rail-right">${appliedHTML(applied, "depState.railways.clear(); depState.holdings.clear(); depState.repairs.clear(); depState.services.clear(); renderDepots()")}</aside>
      <div class="span-cr">
        <div class="depot-count">${list.length === DATA.depots.length ? `всего добавлено: <b>${pl(list.length, "депо", "депо", "депо")}</b>` : `найдено: <b>${pl(list.length, "депо", "депо", "депо")}</b>`}</div>
        <div class="depot-split${sel ? "" : " single"}">
          <div class="depot-table-wrap"><table class="depot-table">
            <thead><tr><th>Дорога</th><th>Холдинг</th><th>Депо</th><th></th></tr></thead>
            <tbody>${rows.map(d => `<tr class="${d.id === depState.selected ? "sel" : ""}" onclick="nav('${d.id === depState.selected ? depotHash() : "#/depot/" + d.id}')">
              <td>${esc(RAILWAY_BY_ID.get(d.railway_id) || "—")}</td><td>${esc(HOLDING_BY_ID.get(d.holding_id)?.short_name || "—")}</td>
              <td class="name">${esc(d.name)}${stampOff(d) ? ` <span class="stamp-off" title="Клеймо ${esc(d.stamp_status.toLowerCase())}о (реестр РС ФЖТ)">клеймо ${esc(d.stamp_status.toLowerCase())}о</span>` : ""}</td><td class="more">${d.id === depState.selected ? "✕" : "подробнее"}</td></tr>`).join("") || `<tr><td colspan="4" class="empty-state">Нет депо с такими параметрами</td></tr>`}</tbody>
          </table></div>
          ${sel ? depotPanelHTML(sel) : ""}
        </div>
      </div>
    </div>
  </div>`;
  wireDepotMap(visible);
  if (sel && route.lastGroup === "depots") $("depot-panel")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
