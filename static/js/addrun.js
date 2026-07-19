let pendingReview = null;
let pendingDetail = null;
let pendingTrades = null;
let pendingPairlistCount = null;
let pendingPairlistHash = null;

document.getElementById('trades-file').addEventListener('change', (e)=>{
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = evt => {
    const result = parseTradesJSON(evt.target.result);
    if(result.error){
      pendingTrades = null;
      pendingPairlistCount = null;
      pendingPairlistHash = null;
      document.getElementById('trades-status').innerHTML = `<div class="parse-status warn">${result.error}</div>`;
    } else {
      pendingTrades = result.trades;
      pendingPairlistCount = result.pairlist_count;
      pendingPairlistHash = result.pairlist_hash;
      const plNote = result.pairlist_count ? ` &middot; pairlist: ${result.pairlist_count} pairs` : '';
      document.getElementById('trades-status').innerHTML = `<div class="parse-status ok">Parsed ${result.trades.length} individual trades${plNote}.</div>`;
    }
  };
  reader.readAsText(file);
});

function parseAndReview(){
  const text = document.getElementById('log-paste').value;
  const statusEl = document.getElementById('parse-status');
  if(!text.trim()){
    statusEl.innerHTML = '<div class="parse-status warn">Paste a log first.</div>';
    return;
  }
  const parsed = parseFreqtradeLog(text);
  pendingDetail = parseAllDetailTables(text);
  // detected_leverage is a UI-only helper (used below to auto-fill the label) — it's not
  // a real saved field, so it shouldn't trigger a "needs manual check" warning if absent.
  const missing = Object.entries(parsed)
    .filter(([k,v])=> k !== 'detected_leverage' && (v===null || v===undefined))
    .map(([k])=>k);
  pendingReview = parsed;

  // Fully auto-assign the label from the log's own content — strategy name (fixed, this
  // tool is NFIx7-only), leverage from the resolved strategy class name, full version from
  // the "NFI strategy version" line — whenever the label field is empty or still just the
  // untouched filename-based leverage guess. Never overwrites something the user typed.
  const labelEl = document.getElementById('lev-label');
  const isUntouched = labelEl.value.trim() === '' || /^\d+x$/i.test(labelEl.value.trim());
  if(isUntouched && parsed.detected_leverage){
    let newLabel = `NFIx7-${parsed.detected_leverage}`;
    if(parsed.nfi_version) newLabel += `-${parsed.nfi_version}`;
    labelEl.value = newLabel;
  } else if(parsed.nfi_version && /^\d+x$/i.test(labelEl.value.trim())){
    // fallback: leverage was already typed/guessed from filename, build the full label around it
    labelEl.value = `NFIx7-${labelEl.value.trim()}-${parsed.nfi_version}`;
  }

  const detailSummary = `Pairs: ${pendingDetail.pairs.length} &middot; Exit reasons: ${pendingDetail.exits.length} &middot; Enter tags: ${pendingDetail.enters.length} &middot; Days: ${pendingDetail.days.length}`;

  statusEl.innerHTML = (missing.length
    ? `<div class="parse-status warn">Parsed with ${missing.length} field(s) needing a manual check (highlighted below): ${missing.join(', ')}</div>`
    : `<div class="parse-status ok">Parsed successfully &mdash; review the numbers below, then save.</div>`)
    + `<div class="parse-status ok" style="margin-top:4px;">${detailSummary}</div>`;

  const fields = [
    ['cagr','CAGR %'], ['sharpe','Sharpe'], ['sortino','Sortino'], ['calmar','Calmar'], ['maxdd','Max Drawdown %'],
    ['pf','Profit Factor'], ['sqn','SQN'], ['trades','Total Trades'], ['win_days','Win Days'],
    ['lose_days','Lose Days'], ['worst_trade','Worst Trade %'], ['liq_count','Liquidations'],
    ['sl_count','Stop-loss Exits'], ['final_bal','Final Balance'],
    ['period_start','Period Start'], ['period_end','Period End'], ['max_trades','Max Open Trades'], ['deposit','Deposit (USDT)'], ['exchange','Exchange'], ['nfi_version','NFI Version'], ['grind_mode_max_slots','Grind Mode Max Slots (manual)']
  ];

  document.getElementById('review-panel').innerHTML = `
    <div class="review-grid">
      ${fields.map(([key,label])=>`
        <div class="review-field">
          <label>${label}</label>
          <input type="text" id="rv-${key}" value="${parsed[key] ?? ''}" class="${parsed[key]==null?'missing':''}">
        </div>`).join('')}
    </div>
    <button class="btn" onclick="saveRun()">Save this run</button>
  `;
}

async function saveRun(){
  const lev = document.getElementById('lev-label').value.trim();
  if(!lev){ alert('Enter a strategy name first (e.g. "3x-413").'); return; }
  const numFields = ['cagr','sharpe','sortino','calmar','maxdd','pf','sqn','trades','win_days','lose_days','worst_trade','liq_count','sl_count','final_bal','max_trades','deposit','grind_mode_max_slots'];
  const textFields = ['period_start','period_end','exchange','nfi_version'];
  const run = {};
  numFields.forEach(k=>{
    const el = document.getElementById('rv-'+k);
    const v = parseFloat(el ? el.value : '');
    run[k] = isNaN(v) ? 0 : v;
  });
  textFields.forEach(k=>{
    const el = document.getElementById('rv-'+k);
    run[k] = el ? el.value.trim() : '';
  });
  // pairlist fingerprint comes from the trades.json parse, not a review-panel field —
  // only attach it if a trades file was actually loaded this time.
  if(pendingPairlistCount != null) run.pairlist_count = pendingPairlistCount;
  if(pendingPairlistHash != null) run.pairlist_hash = pendingPairlistHash;

  const ok = await apiSaveRun(lev, run);
  if(!ok) return; // don't touch UI/RUNS state further — the alert already explained why
  RUNS[lev] = run;

  const detailFailures = [];
  if(pendingDetail){
    for(const [kind, rows] of Object.entries(pendingDetail)){
      try{
        const dRes = await fetch(`${API}/${encodeURIComponent(lev)}/detail/${kind}`, {
          method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(rows)
        });
        if(!dRes.ok) detailFailures.push(kind);
      }catch(e){ console.error(`failed saving ${kind} detail`, e); detailFailures.push(kind); }
    }
  }
  if(pendingTrades){
    try{
      const tRes = await fetch(`${API}/${encodeURIComponent(lev)}/detail/trades`, {
        method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(pendingTrades)
      });
      if(!tRes.ok) detailFailures.push('trades');
    }catch(e){ console.error('failed saving trades', e); detailFailures.push('trades'); }
  }
  if(detailFailures.length){
    alert(`The run itself saved, but this detail data did NOT save: ${detailFailures.join(', ')}.\n\nThose tabs may show stale or missing data for this run — try saving again.`);
  }

  recompute();
  renderHero();
  buildFilterBar(); buildSelector(); refreshCompareUI();
  buildHistory();
  render(lev);
  clearAddRun();
  document.getElementById('add-run').classList.remove('open');
}

function clearAddRun(){
  document.getElementById('log-paste').value='';
  document.getElementById('lev-label').value='';
  document.getElementById('parse-status').innerHTML='';
  document.getElementById('trades-status').innerHTML='';
  document.getElementById('review-panel').innerHTML='';
  pendingReview=null;
  pendingDetail=null;
  pendingTrades=null;
  pendingPairlistCount=null;
  pendingPairlistHash=null;
}

document.getElementById('log-file').addEventListener('change', (e)=>{
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = evt => { document.getElementById('log-paste').value = evt.target.result; };
  reader.readAsText(file);
  // guess leverage from filename, e.g. baseline_7x_console.log
  const m = file.name.match(/(\d+x)/i);
  if(m) document.getElementById('lev-label').value = m[1];
});

async function deleteRun(lev){
  if(!confirm(`Remove the ${lev.toUpperCase()} run? This can't be undone.`)) return;
  delete RUNS[lev];
  await apiDeleteRun(lev);
  recompute();
  renderHero();
  buildFilterBar(); buildSelector(); refreshCompareUI();
  buildHistory();
  if(ORDER.length) render(currentLev && RUNS[currentLev] ? currentLev : ORDER[0]);
  else {
    document.getElementById('subnav').innerHTML = '';
    document.getElementById('run-banner').innerHTML = '';
    document.getElementById('main').innerHTML = '<div class="panel" style="grid-column:1/-1;text-align:center;color:var(--text-faint);">No runs yet — add one above with "+ ADD NEW RUN".</div>';
  }
}

