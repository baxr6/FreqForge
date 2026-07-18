let activeExchangeFilter = 'all';
let activeVersionFilter = 'all';

function extractVersion(label){
  const m = label.match(/v?\d+\.\d+\.\d+/i);
  return m ? m[0] : null;
}

function getVersionForFiltering(lev){
  // Prefer the real nfi_version field (parsed from the log's "NFI strategy version:" line)
  // over guessing from the label text — falls back to label-parsing for older saved runs
  // that predate this field.
  const d = DATA[lev];
  return (d && d.nfi_version) || extractVersion(lev);
}

function passesFilters(lev){
  const d = DATA[lev];
  if(activeExchangeFilter !== 'all' && (d.exchange || 'Unknown') !== activeExchangeFilter) return false;
  if(activeVersionFilter !== 'all' && (getVersionForFiltering(lev) || 'Unversioned') !== activeVersionFilter) return false;
  return true;
}

function buildFilterBar(){
  const bar = document.getElementById('filter-bar');
  const wrap = document.querySelector('.filter-bar-wrap');
  if(ORDER.length < 4){ bar.innerHTML = ''; if(wrap) wrap.style.display = 'none'; return; } // not worth showing filters for a handful of runs
  if(wrap) wrap.style.display = '';

  const exchanges = [...new Set(ORDER.map(k => DATA[k].exchange || 'Unknown'))].sort();
  const versions = [...new Set(ORDER.map(k => getVersionForFiltering(k) || 'Unversioned'))].sort();

  const visibleCount = ORDER.filter(passesFilters).length;
  const showClear = activeExchangeFilter !== 'all' || activeVersionFilter !== 'all';

  bar.innerHTML = `
    <span class="filter-icon">&#9881;</span>
    <div class="filter-group">
      <label>Exchange</label>
      <select id="filter-exchange">
        <option value="all">All (${exchanges.length})</option>
        ${exchanges.map(e => `<option value="${e}" ${activeExchangeFilter===e?'selected':''}>${e}</option>`).join('')}
      </select>
    </div>
    <div class="divider"></div>
    <div class="filter-group">
      <label>Version</label>
      <select id="filter-version">
        <option value="all">All (${versions.length})</option>
        ${versions.map(v => `<option value="${v}" ${activeVersionFilter===v?'selected':''}>${v}</option>`).join('')}
      </select>
    </div>
    ${showClear ? `<button class="pill-btn" onclick="clearFilters()">&times; clear filters</button>` : ''}
    <span class="filter-count">${visibleCount} of ${ORDER.length} runs</span>
  `;
  document.getElementById('filter-exchange').addEventListener('change', e=>{
    activeExchangeFilter = e.target.value;
    buildFilterBar(); buildSelector(); refreshCompareUI();
  });
  document.getElementById('filter-version').addEventListener('change', e=>{
    activeVersionFilter = e.target.value;
    buildFilterBar(); buildSelector(); refreshCompareUI();
  });
}

function clearFilters(){
  activeExchangeFilter = 'all';
  activeVersionFilter = 'all';
  buildFilterBar(); buildSelector(); refreshCompareUI();
}

function buildSelector(){
  const sel = document.getElementById('selector');
  const visible = ORDER.filter(passesFilters);
  if(visible.length === 0){
    sel.innerHTML = `<div class="empty-note" style="padding:16px;">No runs match the current filters. <button class="pill-btn" onclick="clearFilters()">clear filters</button></div>`;
    return;
  }
  sel.innerHTML = visible.map(k => `
    <button class="lev-tab" data-lev="${k}" data-band="${bandOf(DATA[k].grade)}">
      <span class="lv">${escapeHtml(k.toUpperCase())}</span>
      <span class="gr">${DATA[k].grade} &middot; ${DATA[k].total.toFixed(0)}</span>
    </button>`).join('');
  sel.querySelectorAll('.lev-tab').forEach(btn=>{
    btn.addEventListener('click', ()=> selectLeverage(btn.dataset.lev));
  });
  // if the currently-selected run got filtered out, jump to the first still-visible one
  if(currentLev && !visible.includes(currentLev) && visible.length){
    selectLeverage(visible[0]);
  }
}

/* ============ LOG PARSER ============ */
