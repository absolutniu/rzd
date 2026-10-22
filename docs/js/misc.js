/* ============================================================
   Ближайшее депо (#/nearest), Новинки (#/new), О ресурсе, Контакты, запуск
   ============================================================ */
const nearState = { from: null, railway: "", holding: "", repair: "", model: null, service: "" };

function renderNearest() {
  SUGGEST.nearfrom = { source: depotSource, pick: id => { nearState.from = id; renderNearest(); } };
  SUGGEST.nearmodel = { source: vagonSource, pick: id => { nearState.model = id; renderNearest(); } };
  const from = nearState.from ? DEPOT_BY_ID.get(nearState.from) : null;
  const model = nearState.model ? VAGON_BY_ID.get(nearState.model) : null;
  const sel = (key, opts, empty) => `<select class="text-input" onchange="nearState.${key}=this.value; renderNearest()"><option value="">${empty}</option>${opts.map(([v, l]) => `<option value="${esc(v)}" ${nearState[key] === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
  const rails = [...new Set(DATA.depots.map(d => d.railway_id).filter(Boolean))].map(id => [id, RAILWAY_BY_ID.get(id)]).sort((a, b) => a[1].localeCompare(b[1], "ru"));

  let results = "";
  if (from) {
    const forModel = model ? depotsForVagon(model).depots : null;
    const list = DATA.depots.filter(d => d.id !== from.id && d.latitude != null && from.latitude != null)
      .filter(d => !nearState.railway || d.railway_id === nearState.railway)
      .filter(d => !nearState.holding || d.holding_id === nearState.holding)
      .filter(d => !forModel || forModel.has(d.id))
      .filter(d => !nearState.repair || (forModel ? forModel.get(d.id) : depotRepairTypes(d.id)).has(nearState.repair))
      .filter(d => !nearState.service || depotServices(d.id).some(l => l.service_id === nearState.service))
      .map(d => ({ d, km: haversineKm(from, d) })).sort((a, b) => a.km - b.km).slice(0, 20);
    results = `<div class="near-results"><h3>Ближайшие к ${esc(from.name)} ${list.length ? `<span class="mfr-sub">— расстояние по прямой</span>` : ""}</h3>
      ${list.length ? `<div class="depot-table-wrap"><table class="depot-table"><thead><tr><th>№</th><th>Депо</th><th>Дорога</th><th>Холдинг</th><th style="text-align:right">Расстояние</th></tr></thead>
        <tbody>${list.map(({ d, km }, i) => `<tr onclick="nav('#/depot/${d.id}')"><td>${i + 1}</td><td class="name">${esc(d.name)}</td><td>${esc(RAILWAY_BY_ID.get(d.railway_id) || "—")}</td><td>${esc(HOLDING_BY_ID.get(d.holding_id)?.short_name || "—")}</td><td style="text-align:right" class="dist">${fmtNum(Math.round(km))} км</td></tr>`).join("")}</tbody></table></div>`
        : `<p class="no-data">Нет депо с такими параметрами — ослабьте условия справа.</p>`}</div>`;
  } else results = `<div class="near-results"><p class="no-data" style="font-size:14.5px">Укажите текущее депо — покажем ближайшие, подходящие под параметры.</p></div>`;

  $("view-nearest").innerHTML = `<div class="wrap">
    <a class="breadcrumbs" style="display:inline-block;text-decoration:none" href="#/depots">← Все депо</a>
    <h1 style="font-size:30px;margin:10px 0 0;font-weight:800">Найти ближайшее депо</h1>
    <div class="near-grid">
      <div><h2>Текущее депо</h2>
        ${from ? `<div style="margin-bottom:10px">${chipHTML(from.name, "nearState.from=null; renderNearest()", "lg")}</div>` : ""}
        ${suggestInputHTML("nearfrom", "например, ВЧДр Партизанск")}
        ${from ? `<p class="caption" style="font-size:12.5px">${esc(RAILWAY_BY_ID.get(from.railway_id) || "")} · ст. ${esc(from.adjoining_station || "—")}</p>` : ""}
      </div>
      <div><h2>Требуемые параметры</h2>
        <div class="near-params">
          <div><label>дорога</label>${sel("railway", rails, "любая")}</div>
          <div><label>ремонтный холдинг</label>${sel("holding", DATA.repairHoldings.map(h => [h.id, h.short_name]), "любой")}</div>
          <div><label>тип ремонта</label>${sel("repair", DATA.repairTypes.map(r => [r.id, r.name]), "любой")}</div>
          <div><label>модель вагона</label>${model ? `<div style="margin-bottom:6px">${chipHTML(model.model, "nearState.model=null; renderNearest()")}</div>` : ""}${suggestInputHTML("nearmodel", "введите модель вагона")}</div>
          <div><label>дополнительные услуги</label>${sel("service", DATA.depotServices.map(s => [s.id, s.name]), "не важно")}</div>
        </div>
      </div>
    </div>
    ${results}
  </div>`;
}

function renderNew() {
  const list = VAGONS.filter(v => v.cert?.from).sort((a, b) => b.cert.from.localeCompare(a.cert.from)).slice(0, 12);
  $("view-new").innerHTML = bandHTML("Новинки", "Модели с самыми свежими сертификатами ТР ТС — по дате начала действия сертификата.") + `<div class="wrap">
    ${crumbsHTML([["Главная", "#/"], ["Новинки", null]])}
    <div class="vgrid" style="margin-top:26px">${list.map((v, i) => `<div style="display:flex;flex-direction:column;gap:6px"><span class="mfr-sub">сертификат с ${fmtDate(v.cert.from)}</span>${vagonCardHTML(v, i)}</div>`).join("")}</div>
  </div>`;
}

function renderAbout() {
  const n = { v: VAGONS.length, m: mainMfrs().length, d: DATA.depots.length, c: DATA.cargoTypes.length, b: DATA.bogies.length };
  $("view-about").innerHTML = bandHTML("О ресурсе") + `<div class="wrap">
    ${crumbsHTML([["Главная", "#/"], ["О ресурсе", null]])}
    <div class="prose" style="margin-top:20px">
      <p>«Вагонотека» — справочник по грузовым вагонам российского производства: характеристики моделей, заводы-изготовители,
      допустимые грузы, ремонтные депо и запасные части — в одном месте, без поиска по разрозненным документам.</p>
      <h2>Что внутри</h2>
      <ul>
        <li>${pl(n.v, "модель", "модели", "моделей")} вагонов — характеристики, сертификаты ТР ТС, межремонтные нормативы;</li>
        <li>${pl(n.m, "вагоностроительное предприятие", "вагоностроительных предприятия", "вагоностроительных предприятий")} с филиалами;</li>
        <li>${fmtNum(n.c)} наименований грузов по ЕТСНГ и модели, которые их перевозят;</li>
        <li>${pl(n.d, "ремонтное депо", "ремонтных депо", "ремонтных депо")} трёх холдингов — компетенции и авторизации;</li>
        <li>${pl(n.b, "модель тележки", "модели тележек", "моделей тележек")} и чертежи комплектующих, допустимые при ремонте (в т.ч. по Прил.Е РД 32 ЦВ 052-2009).</li>
      </ul>
      <h2>Источник данных</h2>
      <p>Внутренняя база «Интеллектуальный поиск вагонов» (выгрузка от 18.10.2026). Данные пополняются; там, где сведений пока нет, на страницах так и написано.</p>
    </div>
  </div>`;
}
function renderContacts() {
  $("view-contacts").innerHTML = bandHTML("Контакты") + `<div class="wrap">
    ${crumbsHTML([["Главная", "#/"], ["Контакты", null]])}
    <div class="prose" style="margin-top:20px"><p class="no-data" style="font-size:15px">Контакты редакции ресурса пока не указаны.</p>
    <p>Контакты заводов — в карточках <a href="#/mfrs">вагоностроительных предприятий</a>, контакты ремонтных холдингов — в карточках <a href="#/depots">депо</a>.</p></div>
  </div>`;
}

/* ============================================================
   Запуск
   ============================================================ */
document.addEventListener("keydown", e => {
  if ((e.key === "Enter" || e.key === " ") && e.target.matches('[role="button"], [role="link"]')) { e.preventDefault(); e.target.click(); }
});
fetch("data/catalog_data.json", { cache: "no-cache" }) // перепроверять у сервера: данные обновляются без смены имени файла
  .then(r => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
  .then(data => {
    initFromData(data);
    wireGlobalSearch();
    window.addEventListener("hashchange", route);
    route();
  })
  .catch(err => {
    console.error(err);
    $("view-loading").innerHTML = `<div class="wrap"><div class="empty-state">Не удалось загрузить data/catalog_data.json (${esc(err.message)}).<br>Откройте страницу через веб-сервер (не как file://) — например через GitHub Pages или <code>python -m http.server</code>.</div></div>`;
  });
