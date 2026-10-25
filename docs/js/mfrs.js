/* ============================================================
   Вагоностроительные предприятия: список #/mfrs и карточка #/mfr/M100
   ============================================================ */
const mfrState = { comp: new Set(), types: new Set() };
const mainMfrs = () => DATA.manufacturers.filter(m => !m.parent_id);
const mfrHasPage = () => true;
const mfrPageId = id => id;
const mfrFamily = id => [id, ...DATA.manufacturers.filter(m => m.parent_id === id).map(m => m.id)];
const mfrVagons = id => { const fam = new Set(mfrFamily(id)); return VAGONS.filter(v => fam.has(v.mfrId)); };
function mfrLogoHTML(m, cls = "") {
  if (m.logo) return `<div class="mfr-logo img ${m.logoPlate === "dark" ? "dark" : ""} ${cls}"><img src="${esc(m.logo)}" alt="${esc(m.short_name || m.full_name)}"></div>`;
  // логотипа нет (db/sources/logos -> build_logos.py) — фирменная плашка с кратким названием
  const label = (m.short_name || m.full_name).replace(/^(НПК|АО|ООО|ПАО)\s+/i, "");
  return `<div class="mfr-logo ${cls}" title="Логотип не загружен — показано краткое название">${esc(label)}</div>`;
}
const b25 = m => m.produces_25tf_vagons === "да";

function renderMfrs() {
  const list = mainMfrs().filter(m =>
    (!mfrState.comp.size || mfrState.comp.has(b25(m) ? "yes" : "no")) &&
    (!mfrState.types.size || (m.vagonTypeIds || []).some(t => mfrState.types.has(t))))
    .map(m => ({ m, n: mfrVagons(m.id).length }))
    .sort((a, b) => (b25(b.m) - b25(a.m)) || (b.n - a.n) || (a.m.short_name || "").localeCompare(b.m.short_name || "", "ru"));
  const all = mainMfrs();
  const typeOpts = TYPE_ORDER.map(t => ({ value: t, label: TYPE_META[t].plural, count: all.filter(m => (m.vagonTypeIds || []).includes(t)).length })).filter(o => o.count);
  const applied = [];
  if (mfrState.comp.size) applied.push({ k: "Компетенции 25 тс", v: [...mfrState.comp].map(x => x === "yes" ? "есть" : "нет"), remove: "mfrState.comp.clear(); renderMfrs()" });
  if (mfrState.types.size) applied.push({ k: "Выпускает вагоны", v: [...mfrState.types].map(t => TYPE_META[t].plural), remove: "mfrState.types.clear(); renderMfrs()" });

  $("view-mfrs").innerHTML = bandHTML("Вагоностроительные предприятия России") + `<div class="wrap">
    ${crumbsHTML([["Главная", "#/"], ["Вагоностроительные предприятия России", null]])}
    <div style="display:flex;gap:28px;align-items:flex-start;margin-top:26px;flex-wrap:wrap">
      <div style="flex:1;min-width:0">
        <div class="toolbar">
          ${ddHTML("mfr-comp", { kind: "multi", label: "Компетенции 25 тс", opts: [
            { value: "yes", label: "есть компетенции", count: all.filter(b25).length },
            { value: "no", label: "нет компетенций", count: all.filter(m => !b25(m)).length }],
            get: () => mfrState.comp, set: s => { mfrState.comp = new Set(s); renderMfrs(); } })}
          ${ddHTML("mfr-types", { kind: "multi", label: "Выпускает вагоны", opts: typeOpts, get: () => mfrState.types, set: s => { mfrState.types = new Set(s); renderMfrs(); } })}
        </div>
        <div class="mfr-grid">${list.length ? list.map(({ m, n }) => `<a class="mfr-card" href="#/mfr/${m.id}" style="text-decoration:none;color:inherit">
            <div class="full">${esc(m.full_name)}</div>
            ${mfrLogoHTML(m)}
            <div class="models">${pl(n, "модель", "модели", "моделей")}</div>
            ${b25(m) ? `<div class="b25">${axleBadge("Есть компетенции по производству вагонов 25 тс")}<span>есть компетенции по производству вагонов 25 тс</span></div>` : ""}
          </a>`).join("") : `<div class="empty-state">Нет предприятий с такими параметрами</div>`}</div>
      </div>
      ${applied.length ? `<aside style="width:250px">${appliedHTML(applied, "mfrState.comp.clear(); mfrState.types.clear(); renderMfrs()")}</aside>` : ""}
    </div>
  </div>`;
}

function outputChartSVG(rows) {
  if (!rows || !rows.length) return `<p class="no-data">данные о выпуске по годам не внесены</p>`;
  const W = 520, H = 210, PL = 8, PR = 8, PT = 22, PB = 26;
  const iw = W - PL - PR, ih = H - PT - PB, n = rows.length, gap = iw / n, bw = Math.min(gap * 0.52, 36);
  const maxV = Math.max(...rows.map(r => r.volume || 0), 1), maxS = Math.max(...rows.map(r => r.share || 0), 1);
  const x = i => PL + i * gap + (gap - bw) / 2;
  const yV = v => PT + ih - (v / maxV) * ih, yS = v => PT + ih - (v / maxS) * ih * 0.86;
  const bars = rows.map((r, i) => r.volume == null ? "" : `<rect x="${x(i).toFixed(1)}" y="${yV(r.volume).toFixed(1)}" width="${bw.toFixed(1)}" height="${(PT + ih - yV(r.volume)).toFixed(1)}" rx="2" fill="var(--accent2)" opacity=".85"/>
    <text x="${(x(i) + bw / 2).toFixed(1)}" y="${(yV(r.volume) - 5).toFixed(1)}" text-anchor="middle" font-size="10" fill="var(--ink-soft)">${fmtNum(r.volume)}</text>`).join("");
  const pts = rows.map((r, i) => r.share != null ? `${(x(i) + bw / 2).toFixed(1)},${yS(r.share).toFixed(1)}` : null).filter(Boolean).join(" ");
  const dots = rows.map((r, i) => r.share == null ? "" : `<circle cx="${(x(i) + bw / 2).toFixed(1)}" cy="${yS(r.share).toFixed(1)}" r="3" fill="var(--accent)"/><text x="${(x(i) + bw / 2 + 4).toFixed(1)}" y="${(yS(r.share) + 12).toFixed(1)}" font-size="9" fill="var(--accent)">${fmtNum(r.share)}%</text>`).join("");
  const years = rows.map((r, i) => `<text x="${(x(i) + bw / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="var(--ink-faint)">${r.year}</text>`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;overflow:visible" role="img" aria-label="Выпуск вагонов по годам">
      <line x1="${PL}" x2="${W - PR}" y1="${PT + ih}" y2="${PT + ih}" stroke="var(--line-strong)"/>${bars}<polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2"/>${dots}${years}</svg>
    <div style="display:flex;gap:18px;margin-top:6px;font-size:11.5px;color:var(--ink-soft);flex-wrap:wrap">
      <span><span style="display:inline-block;width:9px;height:9px;background:var(--accent2);border-radius:2px;margin-right:5px"></span>производство грузовых вагонов, тыс. ед.</span>
      <span><span style="display:inline-block;width:12px;height:3px;background:var(--accent);margin:0 5px 3px 0"></span>доля от общего объёма производства, %</span>
    </div>`;
}

function renderMfr(params) {
  const m = MFR_BY_ID.get(params[0]);
  if (!m) { $("view-mfr").innerHTML = bandHTML("Предприятие не найдено") + `<div class="wrap"><p class="empty-state"><a href="#/mfrs">Все предприятия</a></p></div>`; return; }
  const parent = m.parent_id ? MFR_BY_ID.get(m.parent_id) : null;
  const children = DATA.manufacturers.filter(x => x.parent_id === m.id);
  const vagons = mfrVagons(m.id);
  const output = DATA.manufacturerOutput[m.id] || [];
  const certCounts = { ok: 0, warn: 0, danger: 0 };
  vagons.forEach(v => { const c = certClass(v.cert?.status); if (c) certCounts[c.slice(3)]++; });
  const typeIds = (m.vagonTypeIds && m.vagonTypeIds.length) ? m.vagonTypeIds : [...new Set(vagons.map(v => v.typeId))];

  // контакты: по подразделениям, нумерованным в порядке справочника
  const contacts = DATA.manufacturerContacts[m.id] || [];
  const byDept = new Map();
  contacts.forEach(c => { const k = c.deptId || "_"; if (!byDept.has(k)) byDept.set(k, []); byDept.get(k).push(c); });
  const deptOrder = [...DATA.manufacturerDepartments.map(d => d.id), "_"].filter(k => byDept.has(k));
  const deptName = k => k === "_" ? "Прочие" : (DATA.manufacturerDepartments.find(d => d.id === k)?.name || "Прочие");
  const contactsHTML = deptOrder.length ? `<div class="acc" id="mfr-contacts">${deptOrder.map((k, i) => `<details>
      <summary><span class="t">${i + 1}. ${esc(deptName(k))}<span class="n">${byDept.get(k).length}</span></span>${CHEV_SVG}</summary>
      <div class="acc-body"><table class="contacts">${byDept.get(k).map(c => `<tr><td>${esc(c.name || "")}</td><td class="ph">${esc(c.phone || "")}</td><td>${(c.email || "").split(/[,;]/).filter(e => e.trim()).map(e => `<a href="mailto:${esc(e.trim())}">${esc(e.trim())}</a>`).join("<br>")}</td></tr>`).join("")}</table></div>
    </details>`).join("")}</div>
    <button class="more-link" onclick="const ds=[...document.querySelectorAll('#mfr-contacts details')]; const open=!ds.every(d=>d.open); ds.forEach(d=>d.open=open); this.textContent=open?'свернуть все':'показать все'">показать все</button>`
    : `<p class="no-data">контакты не внесены${parent ? ` — см. <a href="#/mfr/${parent.id}">${esc(parent.short_name)}</a>` : ""}</p>`;

  const crumbs = [["Главная", "#/"], ["Вагоностроительные предприятия России", "#/mfrs"]];
  if (parent) crumbs.push([parent.short_name || parent.full_name, `#/mfr/${parent.id}`]);
  crumbs.push([m.full_name, null]);

  $("view-mfr").innerHTML = bandHTML("Вагоностроительные предприятия России") + `<div class="wrap">
    ${crumbsHTML(crumbs)}
    <div class="bento">
      <div class="bcard c5" style="text-align:left">
        <h3 style="font-size:23px;line-height:1.3">${esc(m.full_name)}</h3>
        ${mfrLogoHTML(m, "lg")}
        ${b25(m) ? `<div class="b25-big">${axleBadge()}<span>есть компетенции по<br>производству вагонов 25 тс</span></div>` : ""}
        ${parent ? `<p class="caption" style="text-align:center">входит в <a href="#/mfr/${parent.id}">${esc(parent.full_name)}</a></p>` : ""}
      </div>
      <div class="c3 bstack">
        <div class="bcard">
          <h3>Общие</h3>
          <dl class="kv-inline">
            <dt>Страна</dt><dd>${esc(m.country || "—")}</dd>
            <dt>Регион</dt><dd>${esc(m.region || "—")}</dd>
            <dt>Город</dt><dd>${esc(m.city || "—")}</dd>
          </dl>
          ${m.website ? `<div class="bcard-foot">${siteLink(m.website, "на сайт")}</div>` : ""}
        </div>
        <div class="bcard" style="display:flex;justify-content:space-around;gap:10px;text-align:left">
          <div><div class="mfr-sub" style="font-style:italic">Персонал</div><div style="font-size:22px;font-weight:800">${m.staff != null ? fmtNum(m.staff) + " тыс." : "—"}</div><div>человек</div></div>
          <div><div class="mfr-sub" style="font-style:italic">Мощности</div><div style="font-size:22px;font-weight:800">${m.capacity != null ? fmtNum(m.capacity) + " тыс." : "—"}</div><div>вагонов в год</div></div>
        </div>
      </div>
      <div class="bcard c4">
        <h3>Выпуск вагонов в ретроспективе</h3>
        ${outputChartSVG(output)}
      </div>

      <div class="bcard c5">
        <h3>Типы выпускаемых вагонов</h3>
        ${typeIds.length ? `<div class="type-icon-grid">${TYPE_ORDER.filter(t => typeIds.includes(t)).map(t => `<a class="type-icon-item" href="${catalogHash({ type: t })}" style="text-decoration:none">${ICONS[t]}<span>${TYPE_META[t].plural}</span></a>`).join("")}</div>` : `<p class="no-data">не указаны</p>`}
        <div class="models-count"><span>Количество моделей вагонов</span><b>${vagons.length}</b></div>
      </div>
      <div class="bcard c7">
        <h3>${children.length ? `Предприятия ${esc(m.short_name || "")}` : "Предприятие"}</h3>
        <div class="scroll-x"><table class="grid-table">
          <thead><tr><th>Наименование</th><th>Адрес</th><th>Сфера деятельности</th></tr></thead>
          <tbody>${[m, ...children].map(c => `<tr class="${c.id !== m.id ? "click" : ""}" ${c.id !== m.id ? `onclick="nav('#/mfr/${c.id}')"` : ""}>
            <td>${esc(c.full_name)}</td><td>${esc([c.region, c.city].filter(Boolean).join(", ") || "—")}</td><td>${esc(c.enterprise_type || "—")}</td></tr>`).join("")}</tbody>
        </table></div>
      </div>

      <div class="bcard c5">
        <h3>Сертификаты на вагоны</h3>
        ${vagons.length ? `<div class="cert-counts">
          <div class="row"><b class="st-ok">${certCounts.ok}</b><span>действует</span></div>
          <div class="row"><b class="st-warn">${certCounts.warn}</b><span>приостановлено</span></div>
          <div class="row"><b class="st-danger">${certCounts.danger}</b><span>закончился срок</span></div>
        </div>` : `<p class="no-data">вагонов этого предприятия в каталоге нет</p>`}
      </div>
      <div class="bcard c7">
        <h3>Контакты</h3>
        ${contactsHTML}
      </div>
    </div>
  </div>`;
}
