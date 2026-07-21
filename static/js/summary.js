function dialSVG(score, grade){
  const r = 60, c = 2*Math.PI*r;
  const pct = Math.max(0,Math.min(100,score))/100;
  const offset = c * (1-pct);
  const color = GRADE_COLOR[grade];
  const glow = GRADE_GLOW[grade];
  return `
  <svg class="dial-svg" viewBox="0 0 150 150" style="filter:drop-shadow(0 0 18px ${glow})">
    <circle cx="75" cy="75" r="${r}" fill="none" stroke="var(--panel-raised)" stroke-width="10"/>
    <circle cx="75" cy="75" r="${r}" fill="none" stroke="${color}" stroke-width="10"
      stroke-dasharray="${c}" stroke-dashoffset="${offset}" stroke-linecap="round"
      transform="rotate(-90 75 75)"/>
  </svg>`;
}

function renderRunBanner(lev){
  const d = DATA[lev];
  const banner = document.getElementById('run-banner');
  if(!d){ banner.innerHTML = ''; return; }
  const period = (d.period_start && d.period_end)
    ? `${d.period_start} &rarr; ${d.period_end}`
    : '<span style="color:var(--text-faint);">not recorded</span>';

  // Pairlist mismatch check: compare this run's fingerprint against the most common
  // hash across every other run currently loaded — flags exactly the kind of silent
  // config drift that caused real contaminated results this session.
  let pairlistWarning = '';
  if(d.pairlist_hash){
    const hashCounts = {};
    ORDER.forEach(k => { if(DATA[k].pairlist_hash) hashCounts[DATA[k].pairlist_hash] = (hashCounts[DATA[k].pairlist_hash]||0)+1; });
    const mostCommonHash = Object.keys(hashCounts).sort((a,b)=>hashCounts[b]-hashCounts[a])[0];
    if(mostCommonHash && d.pairlist_hash !== mostCommonHash){
      pairlistWarning = `<span class="rb-badge" style="background:var(--red-dim);color:var(--red);border-color:var(--red);" title="This run's pairlist fingerprint differs from most other runs — likely traded a different pair set, not directly comparable">&#9888; PAIRLIST MISMATCH</span>`;
    }
  }

  banner.innerHTML = `
    <div class="run-banner">
      <div>
        <b>NFIx7BackTest${escapeHtml(lev.toUpperCase())}</b> &middot; Exchange: <b>${escapeHtml(d.exchange) || 'not recorded'}</b>${d.nfi_version ? ` &middot; NFI: <b>${escapeHtml(d.nfi_version)}</b>` : ''}${d.deposit ? ` &middot; Deposit: <b>$${fmtInt(d.deposit)}</b>` : ''} &middot; Period: <b>${period}</b>
        ${d.max_trades ? ` &middot; Max Trades: <b>${d.max_trades}</b>` : ''}
        ${d.pairlist_count ? ` &middot; Pairlist: <b>${d.pairlist_count} pairs</b>` : ''}
        ${d.grind_mode_max_slots ? ` &middot; Grind Slots: <b>${d.grind_mode_max_slots}</b>` : ''}
        <span class="rb-badge" style="${d.market_type==='spot' ? 'background:rgba(62,161,255,.12);color:var(--brand-b);border-color:var(--brand-b);' : ''}">${d.market_type === 'spot' ? 'SPOT' : d.market_type === 'futures' ? 'FUTURES' : 'MARKET: UNKNOWN'}</span>
        ${pairlistWarning}
        <button class="del-btn" style="margin-left:8px;color:var(--brand-b);" onclick="toggleQuickEdit('${escapeAttr(lev)}')" title="Rename or set exchange manually">&#9998; edit</button>
      </div>
      <div>
        Trades: <b>${fmtInt(d.trades)}</b> &middot; Score: <b class="rb-score" style="color:${GRADE_COLOR[d.grade]}">${d.total.toFixed(1)}/100 (${d.grade})</b>
      </div>
    </div>
    <div id="quick-edit-panel" style="display:none;"></div>`;
}

function toggleQuickEdit(lev){
  const panel = document.getElementById('quick-edit-panel');
  if(panel.style.display === 'block'){ panel.style.display = 'none'; return; }
  const d = DATA[lev];
  panel.style.display = 'block';
  panel.innerHTML = `
    <div class="panel" style="margin-top:10px;">
      <div class="field-row">
        <div class="field">
          <label>Rename this run (strategy)</label>
          <input type="text" id="qe-newlev" value="${escapeHtml(lev)}">
        </div>
        <div class="field">
          <label>Exchange</label>
          <input type="text" id="qe-exchange" value="${escapeHtml(d.exchange || '')}" placeholder="e.g. Binance, Bybit, Bitget">
        </div>
        <div class="field">
          <label>Market Type</label>
          <select id="qe-markettype">
            <option value="" ${!d.market_type?'selected':''}>Unknown</option>
            <option value="futures" ${d.market_type==='futures'?'selected':''}>Futures</option>
            <option value="spot" ${d.market_type==='spot'?'selected':''}>Spot</option>
          </select>
        </div>
        <div class="field">
          <label>Grind Mode Max Slots</label>
          <input type="text" id="qe-grindslots" value="${escapeHtml(d.grind_mode_max_slots || '')}" placeholder="e.g. 1 (NFI default)">
        </div>
      </div>
      <button class="btn" onclick="saveQuickEdit('${escapeAttr(lev)}')">Save changes</button>
      <button class="btn secondary" onclick="toggleQuickEdit('${escapeAttr(lev)}')">Cancel</button>
      <div id="qe-status"></div>
    </div>`;
}

async function saveQuickEdit(lev){
  const newLev = document.getElementById('qe-newlev').value.trim();
  const exchange = document.getElementById('qe-exchange').value.trim();
  const marketType = document.getElementById('qe-markettype').value;
  const grindSlotsRaw = document.getElementById('qe-grindslots').value.trim();
  const grindSlots = grindSlotsRaw === '' ? null : parseFloat(grindSlotsRaw);
  const statusEl = document.getElementById('qe-status');

  if(!newLev){ statusEl.innerHTML = '<div class="parse-status warn">Label cannot be empty.</div>'; return; }

  try{
    const patchBody = {};
    if(exchange !== (DATA[lev].exchange || '')) patchBody.exchange = exchange;
    if(marketType !== (DATA[lev].market_type || '')) patchBody.market_type = marketType;
    if(grindSlots !== null && !isNaN(grindSlots) && grindSlots !== DATA[lev].grind_mode_max_slots) patchBody.grind_mode_max_slots = grindSlots;
    if(Object.keys(patchBody).length){
      const res = await fetch(`${API}/${encodeURIComponent(lev)}`, {
        method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify(patchBody)
      });
      if(!res.ok){ const b = await res.json().catch(()=>({})); throw new Error(b.error || 'update failed'); }
    }

    let activeLev = lev;
    if(newLev !== lev){
      const res = await fetch(`${API}/${encodeURIComponent(lev)}/rename`, {
        method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({new_lev: newLev})
      });
      if(!res.ok){ const b = await res.json().catch(()=>({})); throw new Error(b.error || 'rename failed'); }
      activeLev = newLev;
    }

    await loadRuns();
    recompute();
    renderHero();
    buildFilterBar(); buildSelector(); refreshCompareUI();
    buildHistory();
    render(activeLev);
  }catch(e){
    statusEl.innerHTML = `<div class="parse-status warn">${e.message}</div>`;
  }
}

function autoCaption(lev, d){
  if(d.market_type === 'spot'){
    // Spot can't be liquidated — d.liq_rate here is purely stop-loss exits, so the
    // caption describes that specifically rather than reusing liquidation/leverage
    // language that would be actively false for a market with no leverage at all.
    if(d.liq_rate===0) return "No stop-loss exits observed in this run.";
    if(d.liq_rate < 1) return "Stop-loss exits are rare but non-zero &mdash; worth a closer look at the worst trade.";
    if(d.liq_rate < 5) return "Stop-loss exits are appearing at a measurable rate.";
    if(d.liq_rate < 10) return "A meaningful share of trades are ending in stop-loss exits, not clean take-profits.";
    return "Stop-loss exits are the dominant outcome at this rate &mdash; worth reviewing exit logic.";
  }
  if(d.liq_rate===0) return "No liquidations or forced stoplosses observed in this run.";
  if(d.liq_rate < 1) return "Liquidation risk is minimal but non-zero &mdash; worth a closer look at the worst trade.";
  if(d.liq_rate < 5) return "Liquidations are appearing at a measurable rate. Risk is rising faster than raw profit alone would suggest.";
  if(d.liq_rate < 10) return "A meaningful share of trades are ending in forced liquidation, not normal stoploss exits.";
  return "Leverage, not the strategy's signals, is now the dominant driver of outcomes at this level.";
}

