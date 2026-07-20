let currentSubTab = 'summary';
const SUBTABS = [
  {kind:'summary', label:'Summary'},
  {kind:'pairs', label:'Pairs'},
  {kind:'days', label:'Heatmap'},
  {kind:'charts', label:'Equity Curve'},
  {kind:'yearly', label:'Yearly'},
  {kind:'exits', label:'Exit Reasons'},
  {kind:'enters', label:'Enter Tags'},
  {kind:'trades', label:'Trades'},
  {kind:'grind', label:'Grind Analysis'},
  {kind:'montecarlo', label:'Monte Carlo'},
];
const DETAIL_API_MAP = {charts:'days', yearly:'days', trades:'trades', grind:'trades', montecarlo:'trades'};

function buildSubnav(lev){
  const nav = document.getElementById('subnav');
  nav.innerHTML = SUBTABS.map(t=>
    `<button class="subtab ${t.kind==='summary'?'active':''}" data-kind="${t.kind}">${t.label}</button>`
  ).join('');
  nav.querySelectorAll('.subtab').forEach(btn=>{
    btn.addEventListener('click', ()=> switchSubTab(lev, btn.dataset.kind));
  });
}

async function switchSubTab(lev, kind){
  currentSubTab = kind;
  document.querySelectorAll('.subtab').forEach(b=> b.classList.toggle('active', b.dataset.kind===kind));

  if(kind === 'summary'){
    render(lev); // rebuild the 3-panel summary and clear submain
    document.querySelectorAll('.subtab').forEach(b=> b.classList.toggle('active', b.dataset.kind===kind));
    return;
  }

  document.getElementById('main').innerHTML = '';
  const sub = document.getElementById('submain');
  sub.innerHTML = '<div class="empty-note">Loading&hellip;</div>';

  const apiKind = DETAIL_API_MAP[kind] || kind;
  let rows;
  try{
    const res = await fetch(`${API}/${encodeURIComponent(lev)}/detail/${apiKind}`);
    rows = await res.json();
    if(apiKind === 'days' && rows && rows.length){
      window.__cachedDayData = rows; // used by the banner's decorative wave graphic
    }
  }catch(e){
    sub.innerHTML = '<div class="empty-note">Could not load this data.</div>';
    return;
  }

  if(!rows || rows.length===0){
    const needsTrades = (kind==='wins'||kind==='losses');
    sub.innerHTML = `<div class="empty-note">No ${kind} data saved for ${escapeHtml(lev.toUpperCase())} yet. Re-parse this run's log through "+ ADD NEW RUN" to populate it${needsTrades ? ' (needs the trades.json file too)' : ''}.</div>`;
    return;
  }

  // Exit reasons / enter tags / heatmap have no per-pair breakdown in freqtrade's own
  // aggregate tables — that only exists on individual trade records. Fetch trades (if the
  // run has any saved) so we can derive "which pairs" ourselves for these three views.
  let pairBreakdown = null;
  if(kind==='exits' || kind==='enters' || kind==='days'){
    try{
      const tRes = await fetch(`${API}/${encodeURIComponent(lev)}/detail/trades`);
      const trades = await tRes.json();
      if(trades && trades.length){
        const field = kind==='exits' ? 'exit_reason' : kind==='enters' ? 'enter_tag' : 'day';
        pairBreakdown = buildPairBreakdown(trades, field);
      }
    }catch(e){ /* no trades saved for this run — views just render without the pair column */ }
  }

  if(kind === 'days') sub.innerHTML = renderHeatmap(rows, pairBreakdown);
  else if(kind === 'charts') sub.innerHTML = renderEquityCurve(rows, DATA[lev]);
  else if(kind === 'yearly') sub.innerHTML = renderYearly(rows);
  else if(kind === 'trades') sub.innerHTML = renderTradesTable(rows, 'all');
  else if(kind === 'grind') sub.innerHTML = renderGrindAnalysis(rows);
  else if(kind === 'montecarlo') sub.innerHTML = renderMonteCarlo(rows, DATA[lev]) + renderInOutSample(rows, DATA[lev]);
  else sub.innerHTML = renderGenericDetailTable(rows, kind, pairBreakdown);
}

function normalizeToDDMMYYYY(dateStr){
  // trades.json dates are typically ISO-ish ("YYYY-MM-DD HH:MM:SS"); day_stats uses "DD/MM/YYYY".
  // Convert defensively — if parsing fails, fall back to the raw string so nothing throws.
  try{
    const d = new Date(dateStr);
    if(isNaN(d.getTime())) return dateStr;
    const dd = String(d.getDate()).padStart(2,'0');
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }catch(e){ return dateStr; }
}

function buildPairBreakdown(trades, field){
  const map = {};
  trades.forEach(t=>{
    const key = field==='day' ? normalizeToDDMMYYYY(t.close_date) : (t[field] || '(none)');
    if(!map[key]) map[key] = {};
    map[key][t.pair] = (map[key][t.pair] || 0) + 1;
  });
  return map;
}

function formatPairList(pairCounts){
  if(!pairCounts) return '';
  const entries = Object.entries(pairCounts).sort((a,b)=> b[1]-a[1]);
  const shown = entries.slice(0,4).map(([p,c])=> c>1 ? `${p} (${c})` : p);
  const extra = entries.length>4 ? ` +${entries.length-4} more` : '';
  return shown.join(', ') + extra;
}

function renderGenericDetailTable(rows, kind, pairBreakdown){
  const labelHead = kind==='pairs' ? 'Pair' : kind==='exits' ? 'Exit Reason' : 'Enter Tag';
  const sorted = [...rows].sort((a,b)=> b.tot_profit_usdt - a.tot_profit_usdt);
  const showPairCol = kind!=='pairs' && pairBreakdown; // pairs tab IS the pair, no need to repeat it
  return `
    <div class="detail-table-wrap">
      ${!showPairCol && kind!=='pairs' ? '<div class="empty-note">No trades.json loaded for this run — showing freqtrade\'s pair-agnostic totals only. Load the trades file via "+ ADD NEW RUN" to see which specific pairs contributed to each row.</div>' : ''}
      <table>
        <thead><tr>
          <th>${labelHead}</th><th>Count</th><th>Avg Profit %</th><th>Tot Profit USDT</th>
          <th>Tot Profit %</th><th>Duration</th><th>Win/Draw/Loss</th><th>Win %</th>${showPairCol ? '<th>Pairs</th>' : ''}
        </tr></thead>
        <tbody>
          ${sorted.map(r=>`
            <tr>
              <td class="lv-cell">${r.label}</td>
              <td>${fmtInt(r.count)}</td>
              <td class="${r.avg_profit_pct>=0?'pos':'neg'}">${fmt(r.avg_profit_pct,2)}</td>
              <td class="${r.tot_profit_usdt>=0?'pos':'neg'}">${fmt(r.tot_profit_usdt,2)}</td>
              <td class="${r.tot_profit_pct>=0?'pos':'neg'}">${fmt(r.tot_profit_pct,2)}</td>
              <td>${r.duration}</td>
              <td>${r.win}/${r.draw}/${r.loss}</td>
              <td>${fmt(r.win_pct,1)}</td>
              ${showPairCol ? `<td style="text-align:left;color:var(--text-dim);">${formatPairList(pairBreakdown[r.label])}</td>` : ''}
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

function renderHeatmap(rows, pairBreakdown){
  const maxAbs = Math.max(...rows.map(r=>Math.abs(r.tot_profit_usdt)), 1);
  const cellColor = (v) => {
    if(v === 0) return 'var(--panel-raised)';
    const intensity = Math.min(1, Math.abs(v)/maxAbs);
    return v > 0
      ? `rgba(61,220,132,${0.15+intensity*0.75})`
      : `rgba(239,81,100,${0.15+intensity*0.75})`;
  };
  const sorted = [...rows].sort((a,b)=>{
    const [da,ma,ya] = a.day.split('/').map(Number);
    const [db,mb,yb] = b.day.split('/').map(Number);
    return new Date(ya,ma-1,da) - new Date(yb,mb-1,db);
  });
  return `
    <div class="panel">
      <div class="panel-label">Daily Profit Heatmap (${sorted.length} trading days)</div>
      <div class="heatmap-grid">
        ${sorted.map(r=>{
          const pairNote = pairBreakdown && pairBreakdown[r.day] ? `, pairs: ${formatPairList(pairBreakdown[r.day])}` : '';
          return `<div class="heat-cell" style="background:${cellColor(r.tot_profit_usdt)}" title="${r.day}: ${fmt(r.tot_profit_usdt,2)} USDT, ${r.trades} trades, ${fmt(r.win_pct,0)}% win${pairNote}"></div>`;
        }).join('')}
      </div>
      <div class="heat-legend">
        <span>Loss</span>
        <div class="heat-cell" style="background:rgba(239,81,100,0.8)"></div>
        <div class="heat-cell" style="background:rgba(239,81,100,0.3)"></div>
        <div class="heat-cell" style="background:var(--panel-raised)"></div>
        <div class="heat-cell" style="background:rgba(61,220,132,0.3)"></div>
        <div class="heat-cell" style="background:rgba(61,220,132,0.8)"></div>
        <span>Profit</span>
        <span style="margin-left:16px;">hover a cell for details${pairBreakdown ? ' (includes pairs)' : ''}</span>
      </div>
    </div>
    ${!pairBreakdown ? '<div class="empty-note">No trades.json loaded for this run — load it via "+ ADD NEW RUN" to see which pairs contributed to each day.</div>' : ''}
    ${renderGenericDaysTable(sorted, pairBreakdown)}`;
}

function renderGenericDaysTable(rows, pairBreakdown){
  return `
    <div class="detail-table-wrap">
      <table>
        <thead><tr><th>Day</th><th>Trades</th><th>Tot Profit USDT</th><th>Profit Factor</th><th>Win/Draw/Loss</th><th>Win %</th>${pairBreakdown ? '<th>Pairs</th>' : ''}</tr></thead>
        <tbody>
          ${rows.map(r=>`
            <tr>
              <td class="lv-cell">${r.day}</td>
              <td>${r.trades}</td>
              <td class="${r.tot_profit_usdt>=0?'pos':'neg'}">${fmt(r.tot_profit_usdt,2)}</td>
              <td>${fmt(r.profit_factor,2)}</td>
              <td>${r.win}/${r.draw}/${r.loss}</td>
              <td>${fmt(r.win_pct,1)}</td>
              ${pairBreakdown ? `<td style="text-align:left;color:var(--text-dim);">${formatPairList(pairBreakdown[r.day])}</td>` : ''}
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

function formatDuration(minutes){
  if(minutes < 60) return `${Math.round(minutes)}m`;
  if(minutes < 1440) return `${(minutes/60).toFixed(1)}h`;
  return `${(minutes/1440).toFixed(1)}d`;
}

function renderGrindAnalysis(trades){
  const withOrders = trades.filter(t => t.order_count > 0);
  if(withOrders.length === 0){
    return '<div class="empty-note">No order-count data in this trades file — it may predate the grind-analysis fields, or your freqtrade version stores orders differently. Re-parse the trades.json to pick this up.</div>';
  }

  // order-count histogram
  const orderBuckets = {};
  trades.forEach(t=>{ const n = t.order_count||0; orderBuckets[n] = (orderBuckets[n]||0)+1; });
  const orderKeys = Object.keys(orderBuckets).map(Number).sort((a,b)=>a-b);
  const maxOrderCount = Math.max(...Object.values(orderBuckets));

  // duration buckets
  const durBuckets = [
    {label:'<1h', test:m=>m<60}, {label:'1-24h', test:m=>m>=60&&m<1440},
    {label:'1-7d', test:m=>m>=1440&&m<10080}, {label:'7-30d', test:m=>m>=10080&&m<43200},
    {label:'30-90d', test:m=>m>=43200&&m<129600}, {label:'90d+', test:m=>m>=129600}
  ];
  durBuckets.forEach(b => b.count = trades.filter(t=>b.test(t.duration_min||0)).length);
  const maxDurCount = Math.max(...durBuckets.map(b=>b.count));

  // grinding trades: >2 orders (simple entry+exit is exactly 2)
  const grinded = trades.filter(t => t.order_count > 2).sort((a,b)=> b.order_count - a.order_count);
  const avgGrindedProfit = grinded.length ? grinded.reduce((s,t)=>s+t.profit_pct,0)/grinded.length : 0;

  // longest-held trades, with a simple "stuck" heuristic: long duration + many orders + low profit-per-day
  const longest = [...trades].sort((a,b)=> (b.duration_min||0) - (a.duration_min||0)).slice(0, 15);
  grindAnalysisLongestTrades = longest;

  return `
    <div class="panel" style="margin-bottom:20px;">
      <div class="panel-label">Order-Count Distribution (2 orders = simple entry+exit, more = grinding occurred)</div>
      <div class="stat-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:18px;">
        <div class="stat"><div class="k">Trades with grinding</div><div class="v">${grinded.length} <span style="font-size:13px;color:var(--text-faint);">of ${trades.length}</span></div></div>
        <div class="stat"><div class="k">Max orders on one trade</div><div class="v">${Math.max(...trades.map(t=>t.order_count||0))}</div></div>
        <div class="stat ${avgGrindedProfit<0?'neg':''}"><div class="k">Avg profit of grinded trades</div><div class="v">${fmt(avgGrindedProfit,2)}%</div></div>
      </div>
      <div style="display:flex;align-items:flex-end;gap:6px;height:100px;">
        ${orderKeys.map(k=>{
          const h = Math.max(4, (orderBuckets[k]/maxOrderCount)*90);
          return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;">
            <div style="font-size:10px;color:var(--text-faint);">${orderBuckets[k]}</div>
            <div style="width:100%;height:${h}px;background:${k>2?'var(--amber)':'var(--green)'};border-radius:3px 3px 0 0;opacity:0.8;" title="${k} orders: ${orderBuckets[k]} trades"></div>
            <div style="font-size:10px;color:var(--text-faint);">${k}</div>
          </div>`;
        }).join('')}
      </div>
      <div style="font-size:10.5px;color:var(--text-faint);margin-top:6px;">orders per trade &rarr;</div>
    </div>

    <div class="panel" style="margin-bottom:20px;">
      <div class="panel-label">Trade Duration Distribution</div>
      <div style="display:flex;align-items:flex-end;gap:10px;height:100px;">
        ${durBuckets.map(b=>{
          const h = Math.max(4, (b.count/maxDurCount)*90);
          return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;">
            <div style="font-size:10px;color:var(--text-faint);">${b.count}</div>
            <div style="width:100%;height:${h}px;background:var(--brand-b);border-radius:3px 3px 0 0;opacity:0.75;"></div>
            <div style="font-size:10px;color:var(--text-faint);">${b.label}</div>
          </div>`;
        }).join('')}
      </div>
    </div>

    <div class="detail-table-wrap">
      <div class="panel-label" style="margin:0 0 8px;">Longest-Held Trades (top 15). <span style="color:var(--brand-b);">FORCE-EXITED?</span> = backtest window ended before this position resolved naturally — outcome is genuinely unknown, not a performance signal. <span style="color:var(--amber);">LOW YIELD?</span> = resolved on its own via a real exit signal, but took a long time and many orders for little return. Click a row to see its actual buy/sell sequence.</div>
      <table>
        <thead><tr><th>Pair</th><th>Duration</th><th>Orders</th><th>Profit %</th><th>Enter Tag</th><th>Exit Reason</th></tr></thead>
        <tbody>
          ${longest.map((t,i)=>{
            const isForceExited = (t.exit_reason||'').includes('force_exit');
            const isLowYield = !isForceExited && t.duration_min > 43200 && t.order_count > 5 && Math.abs(t.profit_pct) < 5;
            const rowStyle = isForceExited ? 'background:rgba(62,161,255,0.08);cursor:pointer;'
                            : isLowYield ? 'background:rgba(240,168,60,0.08);cursor:pointer;'
                            : 'cursor:pointer;';
            const badge = isForceExited
              ? ' <span class="rb-badge" style="font-size:9px;padding:1px 6px;background:rgba(62,161,255,0.15);color:var(--brand-b);border-color:var(--brand-b);">FORCE-EXITED?</span>'
              : isLowYield
              ? ' <span class="rb-badge" style="font-size:9px;padding:1px 6px;">LOW YIELD?</span>'
              : '';
            return `<tr style="${rowStyle}" onclick="showTradeOrders(${i})">
              <td class="lv-cell">${t.pair}${badge}</td>
              <td>${formatDuration(t.duration_min||0)}</td>
              <td>${t.order_count||0}</td>
              <td class="${t.profit_pct>=0?'pos':'neg'}">${fmt(t.profit_pct,2)}</td>
              <td>${t.enter_tag}</td>
              <td>${t.exit_reason}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

let grindAnalysisLongestTrades = [];

function showTradeOrders(index){
  const t = grindAnalysisLongestTrades[index];
  if(!t) return;
  let orders = [];
  try{ orders = JSON.parse(t.orders_json || '[]'); }catch(e){ orders = []; }

  const overlay = document.createElement('div');
  overlay.className = 'trade-modal-overlay';
  overlay.onclick = (e) => { if(e.target === overlay) closeTradeModal(); };

  // Color by open/close semantics (ft_is_entry), not raw buy/sell direction — for a short
  // trade the *entry* order is a "sell" and the *exit* is a "buy", so coloring by literal
  // side alone would show every short's opening as red/negative when it's just the normal
  // way shorts open. Blue = entry/opening action, purple = exit/closing action.
  const ordersHtml = orders.length
    ? orders.map(o => `
        <tr>
          <td class="${o.entry ? 'order-row-entry' : 'order-row-exit'}" style="text-transform:uppercase;font-weight:600;">${o.side}</td>
          <td style="color:var(--text-faint);">${o.entry ? 'Entry' : 'Exit'}</td>
          <td>${o.tag}</td>
          <td>${o.ts ? new Date(o.ts).toISOString().replace('T',' ').slice(0,19) : '—'}</td>
          <td>${o.price ? fmt(o.price, o.price<1?5:2) : '—'}</td>
          <td>${fmt(o.amount||0, 4)}</td>
          <td>${fmt(o.cost,2)}</td>
        </tr>`).join('')
    : '<tr><td colspan="7" class="empty-note">No order-level detail stored for this trade.</td></tr>';

  overlay.innerHTML = `
    <div class="trade-modal">
      <div class="trade-modal-header">
        <h3>${t.pair} &mdash; order sequence <span class="rb-badge" style="background:${t.is_short?'var(--red-dim)':'var(--green-dim)'};color:${t.is_short?'var(--red)':'var(--green)'};border-color:${t.is_short?'var(--red)':'var(--green)'};">${t.is_short?'SHORT':'LONG'}</span></h3>
        <button class="close-btn" onclick="closeTradeModal()">&times;</button>
      </div>
      <div class="trade-modal-body">
        <div class="trade-modal-meta">
          <span>Duration: <b>${formatDuration(t.duration_min||0)}</b></span>
          <span>Orders: <b>${t.order_count||0}</b></span>
          <span>Profit: <b class="${t.profit_pct>=0?'pos':'neg'}">${fmt(t.profit_pct,2)}%</b></span>
          <span>Exit: <b>${t.exit_reason}</b></span>
        </div>
        <div class="detail-table-wrap">
          <table>
            <thead><tr><th>Side</th><th>Action</th><th>Tag</th><th>Filled</th><th>Price</th><th>Amount</th><th>Cost</th></tr></thead>
            <tbody>${ordersHtml}</tbody>
          </table>
        </div>
        <div class="storage-note" style="margin-top:8px;">For short trades, the entry order is a "sell" and the exit is a "buy" — this is normal, not a warning sign. Side and Action are shown separately so it's unambiguous either way.</div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  document.addEventListener('keydown', closeTradeModalOnEsc);
}

function closeTradeModalOnEsc(e){ if(e.key === 'Escape') closeTradeModal(); }

function closeTradeModal(){
  const overlay = document.querySelector('.trade-modal-overlay');
  if(overlay) overlay.remove();
  document.removeEventListener('keydown', closeTradeModalOnEsc);
}

let allTradesCache = [];
let tradesFilterMode = 'all';

function renderTradesTable(rows, initialMode){
  allTradesCache = rows;
  tradesFilterMode = initialMode || 'all';
  return renderTradesTableBody();
}

function setTradesFilter(mode){
  tradesFilterMode = mode;
  document.getElementById('trades-table-container').outerHTML = renderTradesTableBody();
}

function renderTradesTableBody(){
  const wins = allTradesCache.filter(r => r.profit_pct >= 0).sort((a,b)=>b.profit_pct-a.profit_pct);
  const losses = allTradesCache.filter(r => r.profit_pct < 0).sort((a,b)=>a.profit_pct-b.profit_pct);
  const filtered = tradesFilterMode === 'wins' ? wins : tradesFilterMode === 'losses' ? losses : allTradesCache;

  const toggleBtn = (mode, label, count) => `
    <button class="pill-btn" style="${tradesFilterMode===mode ? 'background:rgba(62,161,255,0.22);' : ''}" onclick="setTradesFilter('${mode}')">${label} (${count})</button>`;

  return `
    <div id="trades-table-container">
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:14px;">
        ${toggleBtn('all', 'All', allTradesCache.length)}
        ${toggleBtn('wins', 'Wins', wins.length)}
        ${toggleBtn('losses', 'Losses', losses.length)}
      </div>
      <div class="panel-label" style="margin:0 0 8px;">${filtered.length} trade${filtered.length!==1?'s':''}</div>
      <div class="detail-table-wrap">
        <table>
          <thead><tr><th>Pair</th><th>Enter Tag</th><th>Exit Reason</th><th>Profit %</th><th>Profit Abs</th><th>Open</th><th>Close</th></tr></thead>
          <tbody>
            ${filtered.map(r=>`
              <tr>
                <td class="lv-cell">${escapeHtml(r.pair)}</td>
                <td>${escapeHtml(r.enter_tag)}</td>
                <td>${escapeHtml(r.exit_reason)}</td>
                <td class="${r.profit_pct>=0?'pos':'neg'}">${fmt(r.profit_pct,2)}</td>
                <td class="${r.profit_abs>=0?'pos':'neg'}">${fmt(r.profit_abs,3)}</td>
                <td>${escapeHtml(r.open_date)}</td>
                <td>${escapeHtml(r.close_date)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

function parseDDMMYYYY(s){
  const [d,m,y] = s.split('/').map(Number);
  return new Date(y, m-1, d);
}

function computeKRatio(equitySeries){
  // Linear regression on log(equity) vs day index; K-Ratio = slope / standard error of
  // slope. Measures whether growth is a smooth, statistically confident trend or a noisy
  // path that happens to end up somewhere — same total return can score very differently.
  const n = equitySeries.length;
  if(n < 5) return null; // too few points for a meaningful regression
  const xs = equitySeries.map((_, i) => i);
  const ys = equitySeries.map(e => Math.log(Math.max(e, 0.01)));
  const xMean = xs.reduce((a,b)=>a+b,0) / n;
  const yMean = ys.reduce((a,b)=>a+b,0) / n;
  let sumXY = 0, sumXX = 0;
  for(let i=0;i<n;i++){ sumXY += (xs[i]-xMean)*(ys[i]-yMean); sumXX += (xs[i]-xMean)**2; }
  const slope = sumXY / sumXX;
  const intercept = yMean - slope*xMean;
  let sumResidSq = 0;
  for(let i=0;i<n;i++){ const p = intercept + slope*xs[i]; sumResidSq += (ys[i]-p)**2; }
  const residualVariance = sumResidSq / (n - 2);
  const stdErrSlope = Math.sqrt(residualVariance / sumXX);
  if(!(stdErrSlope > 0) || !isFinite(stdErrSlope)) return null;
  const k = slope / stdErrSlope;
  return isFinite(k) ? k : null;
}

function kRatioVerdict(k){
  if(k == null) return {label:'Not enough data', color:'var(--text-faint)'};
  if(k < 0) return {label:'Not distinguishable from noise', color:'var(--red)'};
  if(k < 5) return {label:'Weak — trend present but noisy', color:'var(--amber)'};
  if(k < 20) return {label:'Good — clear consistent trend', color:'var(--green)'};
  return {label:'Excellent — steady, low-noise growth', color:'var(--green)'};
}

function renderEquityCurve(dayRows, runMeta){
  const sorted = [...dayRows].sort((a,b)=> parseDDMMYYYY(a.day) - parseDDMMYYYY(b.day));
  let cum = 0;
  const points = sorted.map(r=>{ cum += r.tot_profit_usdt; return {date:r.day, cum}; });
  if(points.length < 2){
    return '<div class="empty-note">Not enough daily data points to draw a curve yet.</div>';
  }

  const W = 1000, H = 340, PAD = 44;
  const minY = Math.min(0, ...points.map(p=>p.cum));
  const maxY = Math.max(...points.map(p=>p.cum));
  const xFor = i => PAD + (i/(points.length-1)) * (W-2*PAD);
  const yFor = v => H-PAD - ((v-minY)/(maxY-minY||1)) * (H-2*PAD);

  const linePath = points.map((p,i)=> `${i===0?'M':'L'} ${xFor(i).toFixed(1)} ${yFor(p.cum).toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L ${xFor(points.length-1).toFixed(1)} ${yFor(0).toFixed(1)} L ${xFor(0).toFixed(1)} ${yFor(0).toFixed(1)} Z`;
  const zeroY = yFor(0).toFixed(1);

  const finalCum = points[points.length-1].cum;
  const stepEvery = Math.max(1, Math.floor(points.length/6));
  const xLabels = points.map((p,i)=> (i%stepEvery===0 || i===points.length-1) ? `<text x="${xFor(i)}" y="${H-14}" fill="var(--text-faint)" font-size="10" font-family="var(--mono)" text-anchor="middle">${p.date.slice(0,5)}</text>` : '').join('');

  const startingEquity = (runMeta && runMeta.deposit) ? runMeta.deposit : 500;
  const equitySeries = points.map(p => startingEquity + p.cum);
  const kRatio = computeKRatio(equitySeries);
  const verdict = kRatioVerdict(kRatio);

  return `
    <div class="panel">
      <div class="panel-label">Cumulative Equity Curve (${points.length} trading days)</div>
      <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;margin-top:12px;">
        <line x1="${PAD}" y1="${zeroY}" x2="${W-PAD}" y2="${zeroY}" stroke="var(--line)" stroke-width="1" stroke-dasharray="4,4"/>
        <path d="${areaPath}" fill="${finalCum>=0?'rgba(61,220,132,0.12)':'rgba(239,81,100,0.12)'}"/>
        <path d="${linePath}" fill="none" stroke="${finalCum>=0?'var(--green)':'var(--red)'}" stroke-width="2"/>
        ${xLabels}
        <text x="${PAD}" y="16" fill="var(--text-faint)" font-size="10" font-family="var(--mono)">USDT</text>
      </svg>
      <div class="stat-grid" style="margin-top:18px;grid-template-columns:repeat(3,1fr);">
        <div class="stat"><div class="k">Final cumulative</div><div class="v" style="color:${finalCum>=0?'var(--green)':'var(--red)'}">${fmt(finalCum,2)}</div></div>
        <div class="stat"><div class="k">Peak</div><div class="v">${fmt(maxY,2)}</div></div>
        <div class="stat"><div class="k">Trough</div><div class="v" style="color:${minY<0?'var(--red)':'inherit'}">${fmt(minY,2)}</div></div>
      </div>
      <div style="margin-top:18px;padding:14px 16px;border-radius:8px;background:var(--panel-raised);border:1px solid var(--line);">
        <div style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;">
          <span class="panel-label" style="margin:0;">K-Ratio</span>
          <span style="font-family:var(--mono);font-size:22px;font-weight:600;color:${verdict.color};">${kRatio==null ? '—' : fmt(kRatio,2)}</span>
          <span style="font-family:var(--mono);font-size:12px;color:${verdict.color};">${verdict.label}</span>
        </div>
        <div class="storage-note" style="margin-top:8px;">
          Measures whether this curve's growth is a smooth, statistically consistent trend or a noisy path that
          happens to end up somewhere — two runs with identical final profit can have very different K-Ratios.
          Linear regression on log(equity) vs. day; slope &divide; standard error of the slope. Needs at least 5
          days of data.
        </div>
      </div>
    </div>`;
}

function renderYearly(dayRows){
  const years = {};
  dayRows.forEach(r=>{
    const y = r.day.split('/')[2];
    if(!years[y]) years[y] = {trades:0, profit:0, win:0, draw:0, loss:0, days:0};
    years[y].trades += r.trades;
    years[y].profit += r.tot_profit_usdt;
    years[y].win += r.win; years[y].draw += r.draw; years[y].loss += r.loss;
    years[y].days += 1;
  });
  const sortedYears = Object.keys(years).sort();
  return `
    <div class="detail-table-wrap">
      <table>
        <thead><tr><th>Year</th><th>Trading Days</th><th>Trades</th><th>Tot Profit USDT</th><th>Win/Draw/Loss</th><th>Win %</th></tr></thead>
        <tbody>
          ${sortedYears.map(y=>{
            const v = years[y];
            const winPct = v.trades>0 ? (v.win/v.trades*100) : 0;
            return `<tr>
              <td class="lv-cell">${y}</td>
              <td>${v.days}</td>
              <td>${v.trades}</td>
              <td class="${v.profit>=0?'pos':'neg'}">${fmt(v.profit,2)}</td>
              <td>${v.win}/${v.draw}/${v.loss}</td>
              <td>${fmt(winPct,1)}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
    <div class="empty-note" style="margin-top:8px;">Only spans the years your backtest data actually covers &mdash; a partial year is still a real partial year, not a full 12-month sample.</div>`;
}

function row(label, weight, score, color, subtitle=''){
  return `
    <div class="score-row">
      <div class="label">${label}<div class="weight">wt ${weight}</div>${subtitle ? `<div class="weight" style="color:var(--text-faint);">${subtitle}</div>` : ''}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${score}%;background:${color}"></div></div>
      <div class="val">${score.toFixed(0)}</div>
    </div>`;
}

function buildHistory(){
  const body = document.getElementById('history-body');
  if(ORDER.length===0){ body.innerHTML = ''; return; }
  const rows = [...ORDER].sort((a,b)=> DATA[b].total - DATA[a].total);
  const maxSharpe=Math.max(...ORDER.map(x=>DATA[x].sharpe)), maxCalmar=Math.max(...ORDER.map(x=>DATA[x].calmar));
  const maxDD=Math.max(...ORDER.map(x=>DATA[x].maxdd)), minDD=Math.min(...ORDER.map(x=>DATA[x].maxdd));
  const maxPF=Math.max(...ORDER.map(x=>DATA[x].pf)), maxLiq=Math.max(...ORDER.map(x=>DATA[x].liq_rate));
  const minWorst=Math.min(...ORDER.map(x=>DATA[x].worst_trade));

  body.innerHTML = rows.map(k=>{
    const d = DATA[k];
    return `<tr data-lev="${escapeHtml(k)}" tabindex="0" role="button" aria-label="Inspect ${escapeHtml(k.toUpperCase())}" onclick="selectLeverage('${escapeAttr(k)}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();selectLeverage('${escapeAttr(k)}')}">
      <td class="lv-cell">${escapeHtml(k.toUpperCase())}</td>
      <td class="grade-cell" style="color:${GRADE_COLOR[d.grade]}">${d.grade}</td>
      <td>${d.total.toFixed(1)}</td>
      <td>${fmt(d.cagr,1)}</td>
      <td class="${d.sharpe===maxSharpe?'best':''}">${fmt(d.sharpe,2)}</td>
      <td class="${d.calmar===maxCalmar?'best':''}">${fmtInt(d.calmar.toFixed(0))}</td>
      <td class="${d.maxdd===maxDD?'worst':d.maxdd===minDD?'best':''}">${fmt(d.maxdd,2)}</td>
      <td class="${d.pf===maxPF?'best':''}">${fmt(d.pf,1)}</td>
      <td class="${d.liq_rate===maxLiq?'worst':d.liq_rate===0?'best':''}">${fmt(d.liq_rate,2)}</td>
      <td class="${d.worst_trade===minWorst?'worst':''}">${fmt(d.worst_trade,2)}</td>
      <td>$${fmtInt(d.final_bal.toFixed(0))}</td>
      <td onclick="event.stopPropagation()"><button class="del-btn" onclick="deleteRun('${escapeAttr(k)}')" title="Remove run">&times;</button></td>
    </tr>`;
  }).join('');
}

