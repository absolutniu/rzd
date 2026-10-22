/* ============================================================
   Карточка вагона: #/vagon/W002
   ============================================================ */
const PART_LINKS = [ // часть вагона -> подпись в блоке «Запчасти для ремонта»
  ["Z003", "тормозного оборудования"],
  ["Z002", "автосцепного устройства"],
  ["Z004", "кузова и рамы вагона"],
];

function overhaulTableHTML(rows) {
  if (!rows || !rows.length) return `<p class="no-data">данные по межремонтным срокам не внесены для этой модели</p>`;
  const cell = (y, km) => `${y ?? "—"}${km ? ` <span class="km">/ ${fmtNum(km)} тыс.км</span>` : ""}`;
  return `<div class="scroll-x"><table class="overhaul">
    <thead><tr><th>Критерий</th><th>ДР после постройки</th><th>ДР после ДР</th><th>ДР после КР</th><th>КР после постройки, лет</th></tr></thead>
    <tbody>${rows.map(r => `<tr><td>${esc(r.c)}</td><td>${cell(r.drBuild, r.drBuildKm)}</td><td>${cell(r.drDr, r.drDrKm)}</td><td>${cell(r.drKr, r.drKrKm)}</td><td>${r.krBuild ?? "—"}</td></tr>`).join("")}</tbody>
  </table></div>`;
}

function cargoChipsHTML(ids, uid, page = 24) {
  if (!ids.length) return `<p class="no-data">перечень перевозимых грузов не внесён — уточняйте у производителя</p>`;
  const chip = cid => `<span class="tag-chip alt link" onclick="nav(catalogHash({cargo:['${cid}']}))" title="Все модели, которые перевозят этот груз">${esc(CARGO_BY_ID.get(cid).name)}</span>`;
  return `<div class="tags" id="${uid}">${ids.slice(0, page).map(chip).join("")}<span class="more" style="display:none">${ids.slice(page).map(chip).join("")}</span></div>
    ${ids.length > page ? `<button class="more-link" onclick="const m=document.querySelector('#${uid} .more'); m.style.display='contents'; this.remove();">показать все ${ids.length}</button>` : ""}`;
}

function bogieLinesHTML(v) {
  const ids = v.bogieIds && v.bogieIds.length ? v.bogieIds : (v.bogieId ? [v.bogieId] : []);
  if (!ids.length) return `<p class="no-data">тележка не указана в источнике</p>`;
  return ids.map(id => {
    const b = BOGIE_BY_ID.get(id);
    if (!b) return "";
    const load = b.axle_load_tf ? `${fmtNum(b.axle_load_tf)} тс${b.axle_load_kn ? ` (${fmtNum(b.axle_load_kn)} кН)` : ""}` : "—";
    const note = b.model_note || (b.axle_load_tf >= 25 ? "повышенная нагрузка" : "типовая нагрузка");
    return `<div class="bogie-line">
      <span class="m">${esc(b.model)}</span><span class="l">${load}</span>
      <button class="to" onclick="nav('#/parts/Z001/${b.id}')" title="Чертежи и запчасти тележки">запчасти<b>→</b></button>
      <span class="s">${esc(bogieMfrLabel(b) || "")}</span><span class="s c">${esc(note)}</span>
    </div>`;
  }).join("");
}
function bogieMfrLabel(b) { return b ? (b.manufacturer_id ? mfrShort(b.manufacturer_id) : b.rd9246_manufacturer_label) : null; }

function purchaseHTML(v) {
  const m = MFR_BY_ID.get(v.mfrId);
  const ids = [v.mfrId, m?.parent_id].filter(Boolean);
  const c = ids.flatMap(id => DATA.manufacturerContacts[id] || []).find(c => c.primary);
  if (!c) return `<p class="no-data">контакт отдела продаж не внесён</p>`;
  return `<div class="contact-name">${esc(c.name)}</div>
    ${c.phone ? `<div class="contact-line">${esc(c.phone)}</div>` : ""}
    ${c.email ? `<div class="contact-line">${c.email.split(/[,;]/).map(e => `<a href="mailto:${esc(e.trim())}">${esc(e.trim())}</a>`).join(", ")}</div>` : ""}`;
}

function repairStatsHTML(v) {
  const info = depotsForVagon(v);
  const by = rt => {
    const ds = [...info.depots].filter(([, set]) => set.has(rt)).map(([id]) => DEPOT_BY_ID.get(id)).filter(Boolean);
    return { d: ds.length, r: new Set(ds.map(d => d.railway_id).filter(Boolean)).size };
  };
  const dr = by("RT001"), kr = by("RT002");
  if (!dr.d && !kr.d) return `<p class="no-data">данные о депо для этой модели пока не внесены</p>`;
  const row = (k, s) => `<div class="row"><span class="kind">${k}</span><span class="w">в</span><span class="num"><b>${s.d}</b><span>${plural(s.d, "депо", "депо", "депо")}</span></span><span class="w">на</span><span class="num"><b>${s.r}</b><span>${plural(s.r, "дороге", "дорогах", "дорогах")}</span></span></div>`;
  return `<div class="repair-stat">${dr.d ? row("ДР", dr) : ""}${kr.d ? row("КР", kr) : ""}</div>
    <p class="caption" style="font-size:12.5px;margin-top:10px">${info.mode === "direct" ? "по авторизации на эту модель" : `по компетенции депо для рода «${esc(kindName(v) || TYPE_META[v.typeId].name)}»`}</p>
    <div class="bcard-foot"><a class="go-link" href="#/depots/model/${v.id}">подробнее</a></div>`;
}

function partsLinksHTML(v) {
  const vk = DATA.vagonKitDrawings[v.id] || [];
  const byPart = new Map();
  vk.forEach(([did]) => { const d = DATA.drawings[did]; const p = d && KIT_BY_ID.get(d.kit)?.partId; if (p) byPart.set(p, (byPart.get(p) || 0) + 1); });
  const bogie = v.bogieIds?.[0] || v.bogieId;
  const items = [];
  if (bogie) items.push(`<a href="#/parts/Z001/${bogie}">тележки ${esc(BOGIE_BY_ID.get(bogie)?.model || "")}</a>`);
  PART_LINKS.forEach(([pid, label]) => items.push(`<a href="#/parts/${pid}/${v.id}">${label}${byPart.get(pid) ? `<span class="n">${pl(byPart.get(pid), "чертёж", "чертежа", "чертежей")}</span>` : `<span class="n">нет данных</span>`}</a>`));
  return `<div class="parts-links">${items.join("")}</div><div class="bcard-foot"><a class="go-link" href="#/parts">подробнее</a></div>`;
}

function renderVagon(params) {
  const v = VAGON_BY_ID.get(params[0]);
  if (!v) { $("view-vagon").innerHTML = bandHTML("Модель не найдена") + `<div class="wrap"><p class="empty-state">Такой модели нет в каталоге. <a href="#/catalog">Перейти в каталог</a></p></div>`; return; }
  const meta = TYPE_META[v.typeId];
  const kn = kindName(v);
  const fullType = TYPE_BY_ID.get(v.typeId) || meta.name;
  const m = MFR_BY_ID.get(v.mfrId);
  const cert = v.cert;
  const specRows = FIELD_ORDER.filter(k => v.specs[k] != null).map(k => {
    const [label, unit] = FIELD_LABELS[k];
    const raw = v.specs[k];
    return `<div class="row"><dt>${label}</dt><dd>${typeof raw === "number" ? fmtNum(raw) + unit : esc(raw)}</dd></div>`;
  }).join("");
  const cargo = vagonCargoIds(v);
  const containers = (v.containerIds || []).map(id => CONTAINER_BY_ID.get(id)).filter(Boolean);
  const features = (v.featureIds || []).map(id => FEATURE_BY_ID.get(id)).filter(Boolean);

  const crumbs = [["Главная", "#/"], ["Грузовые вагоны", "#/catalog"], [meta.plural, catalogHash({ type: v.typeId })]];
  if (kn) crumbs.push([kn.replace(/^./, c => c.toUpperCase()), catalogHash({ type: v.typeId, kind: v.kindId })]);
  crumbs.push(["модель " + v.model, null]);

  $("view-vagon").innerHTML = bandHTML("Грузовые вагоны") + `<div class="wrap">
    ${crumbsHTML(crumbs)}
    <div class="bento">
      <div class="bcard vhero c6">
        <h1>${esc(fullType)}${kn ? " " + esc(kn) : ""}</h1>
        <div class="model">${esc(v.model)}</div>
        ${v.modelNote ? `<div class="note">(${esc(v.modelNote)})</div>` : ""}
        <div class="vhero-media">${v.photo ? `<img src="${v.photo}" alt="${esc(meta.name + " " + v.model)}">` : ICONS[v.typeId]}</div>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
          ${v.axle25 ? `<span class="axle-line">${axleBadge()} повышенная осевая нагрузка 25 тс</span>` : "<span></span>"}
          <label class="vcard-compare" style="border:none;padding:0"><input type="checkbox" data-cmp="${v.id}" ${compareSet.has(v.id) ? "checked" : ""} onchange="toggleCompare('${v.id}')"> добавить к сравнению</label>
        </div>
      </div>

      <div class="c6 hero-side">
        <div class="bcard">
          <h3>Общие</h3>
          <dl class="kv-list">
            <div class="kv"><dt>Производитель</dt><dd><a href="#/mfr/${mfrPageId(v.mfrId)}" style="text-decoration:none">${esc(mfrFull(v.mfrId))}</a></dd></div>
            ${v.kdNumber ? `<div class="kv"><dt>Номер КД</dt><dd class="mono">${esc(v.kdNumber)}</dd></div>` : ""}
            ${v.specialization ? `<div class="kv"><dt>Учётная специализация</dt><dd>${esc(v.specialization)}</dd></div>` : ""}
          </dl>
          ${m?.website ? `<div class="bcard-foot">${siteLink(m.website, "на сайт производителя")}</div>` : ""}
        </div>
        <div class="bcard">
          <h3>Сертификат</h3>
          ${cert ? `<dl class="kv-list">
            <div class="kv"><dt>Статус</dt><dd><span class="status-dot ${certClass(cert.status)}">${esc(certShort(cert.status))}</span></dd></div>
            ${cert.number ? `<div class="kv"><dt>№ сертификата</dt><dd>${esc(cert.number)}</dd></div>` : ""}
            ${cert.to ? `<div class="kv"><dt>Действует до</dt><dd>${fmtDate(cert.to)}</dd></div>` : ""}
          </dl>` : `<p class="no-data">сертификат не внесён</p>`}
        </div>
        <div class="bcard">
          <h3>Тележка вагона</h3>
          ${bogieLinesHTML(v)}
        </div>
        <div class="bcard">
          <h3>Покупка</h3>
          ${purchaseHTML(v)}
        </div>
      </div>

      <div class="bcard c5">
        <h3>Конструктивные особенности</h3>
        ${features.length ? `<div class="tags">${features.map(f => `<span class="tag-chip">${esc(f)}</span>`).join("")}</div>` : `<p class="no-data">особенностей не отмечено</p>`}
      </div>
      <div class="bcard c7">
        <h3>Межремонтные нормативы</h3>
        ${overhaulTableHTML(v.overhaul)}
      </div>

      <div class="bcard c5">
        <h3>Характеристики</h3>
        ${specRows ? `<dl class="spec-table">${specRows}</dl>` : `<p class="no-data">характеристики не внесены</p>`}
      </div>
      <div class="bcard c7">
        <h3>Перевозимые грузы ${cargo.length ? `<span class="n">— ${pl(cargo.length, "наименование", "наименования", "наименований")}</span>` : ""}</h3>
        ${cargoChipsHTML(cargo, "vcargo")}
        ${cargo.length ? `<p class="caption" style="font-size:12px;text-align:right">Клик по грузу — все вагоны каталога, которые его перевозят.</p>` : ""}
      </div>

      <div class="bcard c4">
        <h3>Перевозка контейнеров</h3>
        ${containers.length ? `<div class="container-chips">${containers.map(n => `<span>${esc(n)}</span>`).join("")}</div>`
          : `<p class="no-data">${v.typeId === "T004" ? "типоразмеры контейнеров не внесены" : "не предназначен для перевозки контейнеров"}</p>`}
        ${v.typeId === "T004" || containers.length ? `<p class="caption">для вагонов-платформ</p>` : ""}
      </div>
      <div class="bcard c4">
        <h3>Ремонт</h3>
        ${repairStatsHTML(v)}
      </div>
      <div class="bcard c4">
        <h3>Запчасти для ремонта</h3>
        ${partsLinksHTML(v)}
      </div>
    </div>
  </div>`;
}
