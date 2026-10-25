/* ============================================================
   Сравнение вагонов: #/compare (до 4 моделей, выбор сохраняется в браузере)
   ============================================================ */
const COMPARE_MAX = 4;
const compareSet = new Set((() => { try { return JSON.parse(localStorage.getItem("vagonoteka.compare") || "[]"); } catch { return []; } })());
const cmpState = { cargoDiff: false };
function saveCompare() { try { localStorage.setItem("vagonoteka.compare", JSON.stringify([...compareSet])); } catch { /* приватный режим и т.п. */ } }

function toggleCompare(id) {
  if (compareSet.has(id)) compareSet.delete(id);
  else {
    if (compareSet.size >= COMPARE_MAX) compareSet.delete([...compareSet][0]); // вытесняем самую раннюю
    compareSet.add(id);
  }
  saveCompare();
  document.querySelectorAll("input[data-cmp]").forEach(cb => { cb.checked = compareSet.has(cb.dataset.cmp); });
  updateCompareTray();
}
function clearCompare() { compareSet.clear(); saveCompare(); document.querySelectorAll("input[data-cmp]").forEach(cb => cb.checked = false); updateCompareTray(); if (location.hash.startsWith("#/compare")) renderCompare(); }
function updateCompareTray() {
  const n = compareSet.size;
  $("compare-badge").textContent = n;
  $("tray-count").textContent = n;
  const onList = ["view-catalog", "view-vagon"].some(id => $(id).classList.contains("active"));
  $("compare-tray").classList.toggle("show", n >= 1 && onList);
}

function renderCompare() {
  const items = [...compareSet].map(id => VAGON_BY_ID.get(id)).filter(Boolean);
  const head = `<div class="wrap"><a class="breadcrumbs" style="display:inline-block;text-decoration:none" href="#/catalog">← В каталог</a>
    <h1 class="display" style="font-size:30px;margin:10px 0 0">Сравнение вагонов</h1>`;
  if (!items.length) { $("view-compare").innerHTML = head + `<div class="cmp-empty">Отметьте «сравнить» на карточках в каталоге — до ${COMPARE_MAX} моделей одновременно.</div></div>`; return; }

  const label = v => `<div class="cmp-model">${esc(TYPE_META[v.typeId].name)}<span class="num">${esc(v.model)}</span></div>`;
  const rows = [
    ["Производитель", items.map(v => mfrShort(v.mfrId))],
    ["Тележка", items.map(v => (v.bogieIds || [v.bogieId]).filter(Boolean).map(id => BOGIE_BY_ID.get(id)?.model).join(", ") || "—")],
    ["Осевая нагрузка", items.map(v => v.axle25 ? "25 тс" : "23,5 тс")],
    ["Сертификат", items.map(v => certShort(v.cert?.status))],
    ...FIELD_ORDER.filter(k => items.some(v => v.specs[k] != null)).map(k => [FIELD_LABELS[k][0], items.map(v => v.specs[k] != null ? fmtNum(v.specs[k]) + FIELD_LABELS[k][1] : "—")]),
  ];
  const cargoLists = items.map(v => vagonCargoIds(v));
  const common = cargoLists.reduce((acc, l) => acc.filter(id => l.includes(id)), cargoLists[0] || []);

  $("view-compare").innerHTML = head + `
    <details class="cmp-section" open><summary>Характеристики <span class="chev">⌄</span></summary>
      <div class="cmp-body scroll-x"><table class="compare">
        <thead><tr><th></th>${items.map(v => `<th><a href="#/vagon/${v.id}" style="text-decoration:none">${label(v)}</a><button class="rm" onclick="toggleCompare('${v.id}'); renderCompare()">убрать ✕</button></th>`).join("")}</tr></thead>
        <tbody>${rows.map(([k, vals]) => `<tr class="${items.length > 1 && new Set(vals).size > 1 ? "diff" : ""}"><th>${k}</th>${vals.map(x => `<td>${esc(x)}</td>`).join("")}</tr>`).join("")}</tbody>
      </table>
      <p class="caption" style="font-size:12px">Строки, где значения отличаются, подсвечены.</p></div>
    </details>
    <details class="cmp-section" open><summary>Межремонтные нормативы <span class="chev">⌄</span></summary>
      <div class="cmp-body cmp-rows">${items.map(v => `<div class="cmp-row">${label(v)}<div>${overhaulTableHTML(v.overhaul)}</div></div>`).join("")}</div>
    </details>
    <details class="cmp-section" open><summary>Перевозимые грузы <span class="chev">⌄</span></summary>
      <div class="cmp-body">
        ${items.length > 1 ? `<button class="btn ${cmpState.cargoDiff ? "" : "ghost"} sm" onclick="cmpState.cargoDiff=!cmpState.cargoDiff; renderCompare()">${cmpState.cargoDiff ? "показать все" : "оставить разные"}</button>
          <span class="mfr-sub" style="margin-left:10px">общих грузов у всех моделей: ${common.length}</span>` : ""}
        <div class="cmp-rows" style="margin-top:18px">${items.map((v, i) => {
          const ids = cmpState.cargoDiff ? cargoLists[i].filter(id => !common.includes(id)) : cargoLists[i];
          return `<div class="cmp-row">${label(v)}<div>${ids.length ? cargoChipsHTML(ids, "cc" + i, 18) : `<p class="no-data">${cmpState.cargoDiff && cargoLists[i].length ? "все грузы этой модели есть и у остальных" : "перечень грузов не внесён"}</p>`}</div></div>`;
        }).join("")}</div>
      </div>
    </details>
  </div>`;
}
