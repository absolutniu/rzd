/* ============================================================
   Запасные части и комплектующие: #/parts, #/parts/Z001[/B001], #/parts/Z002[/W001]
   Источник: листы 42–47 Excel-основы (часть -> комплект -> деталь, чертежи)
   + Прил.Е РД 32 ЦВ 052-2009 (чертежи при производстве модели тележки = «от производителя»)
   ============================================================ */
const PART_TILES = [
  ["Z001", "Запчасти тележек грузовых вагонов"],
  ["Z002", "Запчасти автосцепного устройства"],
  ["Z003", "Запчасти тормозного оборудования"],
  ["Z004", "Запчасти кузова и рамы"],
];
const partsState = { tab: null, id: null };
let DRAWING_INFO = null; // номер чертежа -> запись из «ID черт + Комплект + Произ»

function renderPartsRoute(params) {
  partsState.tab = PART_BY_ID.has(params[0]) ? params[0] : null;
  partsState.id = params[1] || null;
  renderParts();
}

function drawingMfr(num) {
  if (!DRAWING_INFO) { DRAWING_INFO = new Map(); Object.values(DATA.drawings).forEach(d => DRAWING_INFO.set(d.n, d)); }
  const d = DRAWING_INFO.get(num);
  if (d?.mfrId) return mfrShort(d.mfrId);
  if (d?.mfr) return d.mfr;
  const bogies = DRAWING_BY_NUM.get(num); // чертёж — производственный для какой-то модели тележки (Прил.Е)
  if (bogies) { const lbl = [...bogies].map(id => bogieMfrLabel(BOGIE_BY_ID.get(id))).find(Boolean); if (lbl) return lbl; }
  return null;
}
function drawingChips(nums, uid, page = 20) {
  if (!nums.length) return `<p class="no-data">нет данных</p>`;
  const chip = n => { const m = drawingMfr(n); return `<span class="tag-chip" title="${m ? "Изготовитель: " + esc(m) : "изготовитель не указан в источнике"}">${esc(n)}${m ? ` · <b>${esc(m)}</b>` : ""}</span>`; };
  return `<div class="tags" id="${uid}">${nums.slice(0, page).map(chip).join("")}<span class="more" style="display:none">${nums.slice(page).map(chip).join("")}</span></div>
    ${nums.length > page ? `<button class="more-link" onclick="document.querySelector('#${uid} .more').style.display='contents'; this.remove();">показать все ${nums.length}</button>` : ""}`;
}

/* чертежи комплекта/детали для тележки: «от производителя» и «от других производителей» */
function bogieKitDrawings(b, kitId, detId) {
  const own = new Set((DATA.bogieProduction[b.id] || []).filter(([k, x]) => k === kitId && (x || null) === (detId || null)).map(([, , n]) => n));
  const rows = (DATA.bogieKitDrawings[b.id] || []).map(([did, fromMfr]) => ({ d: DATA.drawings[did], fromMfr })).filter(r => r.d && r.d.kit === kitId && (r.d.det || null) === (detId || null));
  rows.filter(r => r.fromMfr).forEach(r => own.add(r.d.n));
  let all = rows.map(r => r.d.n);
  const hasBogieData = (DATA.bogieKitDrawings[b.id] || []).length > 0;
  if (!hasBogieData && (DATA.bogieProduction[b.id] || []).length) all = DATA.repairFallback[kitId + (detId ? "/" + detId : "")] || [];
  return { own: [...own], others: [...new Set(all)].filter(n => !own.has(n)) };
}
function kitBlockHTML(kit, getter, ownLabel, uid) {
  const main = getter(kit.id, null);
  const details = DATA.partDetails.filter(x => x.kitId === kit.id).map(x => ({ x, ...getter(kit.id, x.id) })).filter(r => r.own.length || r.others.length);
  const total = main.own.length + main.others.length + details.reduce((s, r) => s + r.own.length + r.others.length, 0);
  const mainCol = (main.own.length || main.others.length) ? `<div class="col">
      <h5>${ownLabel}</h5>${drawingChips(main.own, uid + "o")}
      <h5 style="margin-top:18px">от других производителей</h5>${drawingChips(main.others, uid + "x")}</div>` : "";
  const detCol = details.length ? `<div class="col"><div class="det-title">Запчасти</div>${details.map((r, i) => `
      <h6>${esc(r.x.name)}</h6>
      ${r.own.length ? `<div class="mfr-sub" style="margin:-4px 0 6px">${ownLabel}</div>${drawingChips(r.own, `${uid}d${i}o`, 8)}` : ""}
      ${r.others.length ? `<div class="mfr-sub" style="margin:8px 0 6px">от других производителей</div>${drawingChips(r.others, `${uid}d${i}x`, 8)}` : ""}`).join("")}</div>` : "";
  return `<details class="kit"${total ? "" : ' style="opacity:.6"'}>
    <summary>${esc(kit.name)} <span class="n">— ${total ? pl(total, "чертёж", "чертежа", "чертежей") : "нет данных"}</span></summary>
    ${total ? `<div class="kit-body${mainCol && detCol ? "" : " one"}">${mainCol}${detCol}</div>` : `<div class="kit-body one"><p class="no-data">чертежи по этому комплекту пока не внесены</p></div>`}
  </details>`;
}

function bogieRowHTML(b, open) {
  const load = b.axle_load_tf ? `${fmtNum(b.axle_load_tf)} тс` : "—";
  return `<div class="bogie-row" ${open ? "" : `onclick="nav('#/parts/Z001/${b.id}')"`}>
    <div><div class="m">${esc(b.model)}</div><div class="mf">${esc(bogieMfrLabel(b) || b.model_note || "производитель не указан")}</div></div>
    <div style="display:flex;align-items:center"><div class="ld"><b>${load}</b><span>осевая нагрузка</span></div>
      ${open ? `<button class="x" title="Свернуть" onclick="nav('#/parts/Z001')">✕</button>` : `<span class="chev">›</span>`}</div>
  </div>`;
}
const bogieHasData = b => (DATA.bogieKitDrawings[b.id] || []).length || (DATA.bogieProduction[b.id] || []).length;

function bogieTabHTML() {
  const open = BOGIE_BY_ID.get(partsState.id);
  SUGGEST.partbogie = { source: q => DATA.bogies.filter(b => b.model.toLowerCase().includes(q) || (bogieMfrLabel(b) || "").toLowerCase().includes(q)).map(b => ({ id: b.id, label: b.model, sub: bogieMfrLabel(b) || "" })), pick: id => nav(`#/parts/Z001/${id}`) };
  const list = DATA.bogies.slice().sort((a, b) => (!!bogieHasData(b) - !!bogieHasData(a)) || a.model.localeCompare(b.model, "ru"));
  const kits = DATA.partKits.filter(k => k.partId === "Z001");
  const openHTML = open ? `<div class="bogie-open">${bogieRowHTML(open, true)}
      <div class="kit-wrap"><div class="lead">Могут использоваться при ремонте</div>
        ${bogieHasData(open) ? kits.map((k, i) => kitBlockHTML(k, (kit, det) => bogieKitDrawings(open, kit, det), "от производителя тележки", `bk${i}`)).join("")
          : `<p class="no-data">По модели «${esc(open.model)}» чертежей пока нет: данные внесены для тележек тип 2 по ГОСТ 9246 (Прил.Е РД 32 ЦВ 052-2009).</p>`}
        ${(DATA.bogieAssemblyDrawings[open.id] || []).length ? `<p class="caption" style="font-size:12.5px">Чертёж тележки в сборе: ${DATA.bogieAssemblyDrawings[open.id].map(esc).join(", ")}</p>` : ""}
      </div></div>` : "";
  return `<div class="parts-search">
      <div class="panel-title">Поиск по модели</div>
      <label class="field-label" for="si-partbogie">Модель тележки</label>
      ${open ? `<div style="margin-bottom:8px">${chipHTML(open.model, "nav('#/parts/Z001')", "lg")}</div>` : ""}
      ${suggestInputHTML("partbogie", "например, 18-100")}
    </div>
    <div class="parts-sub">Модельный ряд тележек</div>
    <div class="bogie-list">${openHTML}${list.filter(b => b !== open).map(b => bogieRowHTML(b, false)).join("")}</div>`;
}

function vagonPartTabHTML(partId) {
  const v = VAGON_BY_ID.get(partsState.id);
  SUGGEST.partvagon = { source: vagonSource, pick: id => nav(`#/parts/${partId}/${id}`) };
  const withData = VAGONS.filter(x => (DATA.vagonKitDrawings[x.id] || []).some(([did]) => KIT_BY_ID.get(DATA.drawings[did]?.kit)?.partId === partId));
  let body = "";
  if (v) {
    const rows = (DATA.vagonKitDrawings[v.id] || []).map(([did, fromMfr]) => ({ d: DATA.drawings[did], fromMfr })).filter(r => r.d && KIT_BY_ID.get(r.d.kit)?.partId === partId);
    const getter = (kitId, detId) => {
      const rs = rows.filter(r => r.d.kit === kitId && (r.d.det || null) === (detId || null));
      const own = rs.filter(r => r.fromMfr).map(r => r.d.n);
      return { own, others: rs.filter(r => !r.fromMfr).map(r => r.d.n).filter(n => !own.includes(n)) };
    };
    const kits = DATA.partKits.filter(k => k.partId === partId);
    body = `<div class="parts-sub">Могут использоваться при ремонте</div>
      ${rows.length ? `<div class="bogie-open"><div class="kit-wrap">${kits.map((k, i) => kitBlockHTML(k, getter, "от производителя вагона", `vk${i}`)).join("")}</div></div>`
        : `<p class="no-data">Для модели ${esc(v.model)} чертежи по разделу «${esc(PART_BY_ID.get(partId).name)}» пока не внесены.</p>`}`;
  }
  return `<div class="parts-search" style="max-width:520px">
      <div class="panel-title">Поиск по модели вагона</div>
      <label class="field-label" for="si-partvagon">Модель вагона</label>
      ${v ? `<div style="margin-bottom:8px">${chipHTML(v.model, `nav('#/parts/${partId}')`, "lg")}</div>` : ""}
      ${suggestInputHTML("partvagon", "например, 12-196-02")}
      ${!v && withData.length ? `<p class="caption" style="font-size:12.5px">Данные пока внесены для: ${withData.map(x => `<a href="#/parts/${partId}/${x.id}">${esc(x.model)}</a>`).join(", ")}</p>` : ""}
    </div>${body}`;
}

function renderParts() {
  const { tab } = partsState;
  const crumbs = [["Главная", "#/"], ["Запасные части и комплектующие", tab ? "#/parts" : null]];
  if (tab) crumbs.push([PART_TILES.find(t => t[0] === tab)[1], null]);
  $("view-parts").innerHTML = bandHTML("Запасные части и комплектующие") + `<div class="wrap">
    ${crumbsHTML(crumbs)}
    <div class="parts-tiles">${PART_TILES.map(([id, label]) => `<a class="parts-tile${tab === id ? " on" : ""}" href="${tab === id ? "#/parts" : "#/parts/" + id}" style="text-decoration:none">${tab === id ? `<span class="x">✕</span>` : ""}${label}</a>`).join("")}</div>
    ${!tab ? `<p class="cat-intro" style="padding:40px 0 0">Выберите раздел — тележки, автосцепка, тормозное оборудование или кузов и рама.</p>` : tab === "Z001" ? bogieTabHTML() : vagonPartTabHTML(tab)}
  </div>`;
  if (tab === "Z001" && partsState.id) document.querySelector(".kit")?.setAttribute("open", "");
}
