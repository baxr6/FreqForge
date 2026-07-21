let activeExchangeFilter = 'all';
let activeVersionFilter = 'all';
let activeMarketTypeFilter = 'all';
let activeStrategyFilter = 'all';
let searchQuery = '';

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
  if(activeMarketTypeFilter !== 'all' && (d.market_type || 'Unknown') !== activeMarketTypeFilter) return false;
  if(activeStrategyFilter !== 'all' && (d.strategy_family || 'Unknown') !== activeStrategyFilter) return false;
  if(searchQuery && !lev.toLowerCase().includes(searchQuery.toLowerCase())) return false;
  return true;
}

function buildFilterBar(){
  const bar = document.getElementById('filter-bar');
  const wrap = document.querySelector('.filter-bar-wrap');
  if(ORDER.length < 4){ bar.innerHTML = ''; if(wrap) wrap.style.display = 'none'; return; } // not worth showing filters for a handful of runs
  if(wrap) wrap.style.display = '';

  const exchanges = [...new Set(ORDER.map(k => DATA[k].exchange || 'Unknown'))].sort();
  const versions = [...new Set(ORDER.map(k => getVersionForFiltering(k) || 'Unversioned'))].sort();
  const marketTypes = [...new Set(ORDER.map(k => DATA[k].market_type || 'Unknown'))].sort();
  const strategies = [...new Set(ORDER.map(k => DATA[k].strategy_family || 'Unknown'))].sort();

  const visibleCount = ORDER.filter(passesFilters).length;
  const showClear = activeExchangeFilter !== 'all' || activeVersionFilter !== 'all' || activeMarketTypeFilter !== 'all' || activeStrategyFilter !== 'all' || searchQuery !== '';

  bar.innerHTML = `
    <span class="filter-icon">&#128269;</span>
    <input type="text" id="filter-search" class="filter-search-input" placeholder="Search runs..." value="${escapeHtml(searchQuery)}">
    <div class="divider"></div>
    <div class="filter-group">
      <label>Strategy</label>
      <select id="filter-strategy">
        <option value="all">All (${strategies.length})</option>
        ${strategies.map(s => `<option value="${s}" ${activeStrategyFilter===s?'selected':''}>${s}</option>`).join('')}
      </select>
    </div>
    <div class="divider"></div>
    <div class="filter-group">
      <label>Market</label>
      <select id="filter-market">
        <option value="all">All (${marketTypes.length})</option>
        ${marketTypes.map(m => `<option value="${m}" ${activeMarketTypeFilter===m?'selected':''}>${m[0].toUpperCase()+m.slice(1)}</option>`).join('')}
      </select>
    </div>
    <div class="divider"></div>
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
  document.getElementById('filter-search').addEventListener('input', e=>{
    searchQuery = e.target.value;
    buildSelector(); refreshCompareUI();
    // don't rebuild the whole filter bar on every keystroke — it would steal focus from the input
    document.querySelector('.filter-count').textContent = `${ORDER.filter(passesFilters).length} of ${ORDER.length} runs`;
  });
  document.getElementById('filter-strategy').addEventListener('change', e=>{
    activeStrategyFilter = e.target.value;
    buildFilterBar(); buildSelector(); refreshCompareUI();
  });
  document.getElementById('filter-market').addEventListener('change', e=>{
    activeMarketTypeFilter = e.target.value;
    buildFilterBar(); buildSelector(); refreshCompareUI();
  });
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
  activeMarketTypeFilter = 'all';
  activeStrategyFilter = 'all';
  searchQuery = '';
  buildFilterBar(); buildSelector(); refreshCompareUI();
}

let selectorViewMode = null; // null = not yet decided; auto-picks grid once there are enough runs to warrant it

function buildSelector(){
  const sel = document.getElementById('selector');
  const visible = ORDER.filter(passesFilters);
  if(visible.length === 0){
    document.getElementById('selector-view-toggle').innerHTML = '';
    sel.innerHTML = `<div class="empty-note" style="padding:16px;">No runs match the current filters. <button class="pill-btn" onclick="clearFilters()">clear filters</button></div>`;
    return;
  }

  if(selectorViewMode === null) selectorViewMode = visible.length > 6 ? 'grid' : 'tabs'; // auto-pick on first render only — a manual switch afterward always sticks

  const toggleWrap = document.getElementById('selector-view-toggle');
  if(visible.length > 3){
    toggleWrap.innerHTML = `
      <button class="pill-btn" style="${selectorViewMode==='tabs'?'background:rgba(62,161,255,0.22);':''}" onclick="setSelectorView('tabs')">Tabs</button>
      <button class="pill-btn" style="${selectorViewMode==='grid'?'background:rgba(62,161,255,0.22);':''}" onclick="setSelectorView('grid')">Grid</button>`;
  } else {
    toggleWrap.innerHTML = '';
  }

  if(selectorViewMode === 'grid'){
    sel.className = 'selector selector-grid';
    sel.innerHTML = visible.map(k => {
      const d = DATA[k];
      const badges = [d.strategy_family, d.market_type ? d.market_type.toUpperCase() : null, d.exchange].filter(Boolean);
      return `
        <div class="grid-tile" data-lev="${escapeAttr(k)}" data-band="${bandOf(d.grade)}">
          <span class="lv">${escapeHtml(k.toUpperCase())}</span>
          <div class="grid-meta">
            <span class="gr">${d.grade} &middot; ${d.total.toFixed(0)}</span>
          </div>
          ${badges.length ? `<div class="grid-badges">${badges.map(b=>`<span class="grid-badge">${escapeHtml(b)}</span>`).join('')}</div>` : ''}
        </div>`;
    }).join('');
    sel.querySelectorAll('.grid-tile').forEach(el=>{
      el.addEventListener('click', ()=> selectLeverage(el.dataset.lev));
    });
  } else {
    sel.className = 'selector';
    sel.innerHTML = visible.map(k => `
      <button class="lev-tab" data-lev="${escapeAttr(k)}" data-band="${bandOf(DATA[k].grade)}">
        <span class="lv">${escapeHtml(k.toUpperCase())}</span>
        <span class="gr">${DATA[k].grade} &middot; ${DATA[k].total.toFixed(0)}</span>
      </button>`).join('');
    sel.querySelectorAll('.lev-tab').forEach(btn=>{
      btn.addEventListener('click', ()=> selectLeverage(btn.dataset.lev));
    });
  }

  // if the currently-selected run got filtered out, jump to the first still-visible one
  if(currentLev && !visible.includes(currentLev) && visible.length){
    selectLeverage(visible[0]);
  }
}

function setSelectorView(mode){
  selectorViewMode = mode;
  buildSelector();
}

/* ============ LOG PARSER ============ */
