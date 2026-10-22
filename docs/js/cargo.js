/* ============================================================
   Перечень грузов для перевозки: #/cargo, #/cargo/C001
   ============================================================ */
const cargoPage = { picked: null, q: "", limit: 50 };

function renderCargoPage(params) {
  cargoPage.picked = CARGO_BY_ID.has(params[0]) ? params[0] : null;
  cargoPage.limit = 50;
  SUGGEST.cargopage = { source: cargoSource, pick: id => nav(`#/cargo/${id}`) };
  const picked = cargoPage.picked ? CARGO_BY_ID.get(cargoPage.picked) : null;
  $("view-cargo").innerHTML = bandHTML("Перечень грузов для перевозки") + `<div class="wrap cargo-page">
    ${crumbsHTML([["Главная", "#/"], ["Перечень грузов для перевозки", picked ? "#/cargo" : null], ...(picked ? [[picked.name, null]] : [])])}
    <h2>Что нужно перевезти</h2>
    <div class="chip-input big" onclick="$('si-cargopage')?.focus()">
      ${picked ? chipHTML(picked.name, "event.stopPropagation(); nav('#/cargo')", "lg") : ""}
      <div class="rel" style="flex:1;min-width:200px"><input id="si-cargopage" placeholder="${picked ? "" : "например, «бензин» или «зерно»"}" autocomplete="off" value="${esc(cargoPage.q)}"
        oninput="cargoPage.q=this.value; cargoPage.limit=50; renderCargoTable(); renderSuggest('cargopage')" onfocus="renderSuggest('cargopage')" onkeydown="suggestKey('cargopage', event)"
        style="width:100%;border:none;outline:none;background:transparent;color:var(--ink);font-size:16px;padding:6px 2px">
        <div class="suggest" id="sg-cargopage" hidden></div></div>
    </div>
    <div id="cargo-tbl"></div>
  </div>`;
  renderCargoTable();
}

function renderCargoTable() {
  const all = DATA.cargoTypes.map((c, i) => ({ c, no: i + 1 })).filter(({ c }) => !isCargoStub(c));
  let rows;
  if (cargoPage.picked) rows = all.filter(r => r.c.id === cargoPage.picked);
  else {
    const q = cargoPage.q.trim().toLowerCase();
    rows = q ? all.filter(({ c }) => c.name.toLowerCase().includes(q) || (c.etsng_code || "").startsWith(q)) : all;
  }
  const shown = rows.slice(0, cargoPage.limit);
  $("cargo-tbl").innerHTML = `<div class="scroll-x"><table class="cargo-table">
      <thead><tr><th class="l" style="width:80px">№ п/п</th><th class="l">Наименование груза по коду ЕТСНГ</th><th>Код ЕТСНГ</th><th>Моделей для перевозки</th><th>Подробнее</th></tr></thead>
      <tbody>${shown.map(({ c, no }) => {
        const n = CARGO_VAGON_IDS.get(c.id)?.size || 0;
        return `<tr><td class="l">${no}.</td><td class="l">${esc(c.name)}</td><td class="code">${esc(c.etsng_code || "—")}</td>
          <td class="models">${n ? pl(n, "модель", "модели", "моделей") : `<span style="color:var(--ink-faint);font-weight:400">нет моделей</span>`}</td>
          <td>${n ? `<a class="btn dark sm" href="${catalogHash({ cargo: [c.id] })}">к моделям</a>` : ""}</td></tr>`;
      }).join("") || `<tr><td colspan="5" class="empty-state">Ничего не нашлось среди ${fmtNum(all.length)} грузов</td></tr>`}</tbody>
    </table></div>
    ${rows.length > shown.length ? `<div class="pager">показано ${shown.length} из ${fmtNum(rows.length)} <button class="btn ghost sm" onclick="cargoPage.limit+=100; renderCargoTable()">показать ещё</button></div>` : ""}`;
}
