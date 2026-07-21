const COMPARE_PALETTE = ['#8b5cf6','#3ea1ff','#3ddc84','#f0a83c','#ef5164','#e879f9','#22d3ee','#facc15','#fb923c','#a3e635'];
let compareChartOpen = false;

function inspectFromCompare(lev){
  if(!DATA[lev]){
    alert(`"${lev}" no longer exists (renamed or deleted since this chart was drawn) — try re-opening the comparison chart.`);
    return;
  }
  selectLeverage(lev);
}

function refreshCompareUI(){
  buildCompareToggle();
  if(compareChartOpen) renderCompareChart();
}

function buildCompareToggle(){
  const wrap = document.getElementById('compare-toggle-wrap');
  if(ORDER.length < 2){ wrap.innerHTML = ''; return; }
  const visibleCount = ORDER.filter(passesFilters).length;
  const chartIcon = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" style="vertical-align:-2px;margin-right:5px;"><rect x="1" y="9" width="3" height="6" rx="0.5" fill="currentColor"/><rect x="6.5" y="5" width="3" height="10" rx="0.5" fill="currentColor"/><rect x="12" y="1" width="3" height="14" rx="0.5" fill="currentColor"/></svg>`;
  const trendIcon = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" style="vertical-align:-2px;margin-right:5px;"><path d="M1 14L5.5 8L9 11L15 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M11 3H15V7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const statIcon = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" style="vertical-align:-2px;margin-right:5px;"><path d="M2 2v12h12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="5" cy="9" r="1.3" fill="currentColor"/><circle cx="8.5" cy="5.5" r="1.3" fill="currentColor"/><circle cx="12" cy="8" r="1.3" fill="currentColor"/></svg>`;
  wrap.innerHTML = `
    <div style="margin:14px clamp(20px,5vw,64px) 0;display:flex;gap:10px;">
      <button class="pill-btn" onclick="toggleCompareChart()">
        ${chartIcon}${compareChartOpen ? 'Hide' : 'Show'} Comparison Chart ${activeExchangeFilter!=='all'||activeVersionFilter!=='all' ? `(${visibleCount} filtered runs)` : `(all ${visibleCount} runs)`}
      </button>
      <button class="pill-btn" onclick="toggleProgressChart()">
        ${trendIcon}${progressChartOpen ? 'Hide' : 'Show'} Progress Over Time
      </button>
      <button class="pill-btn" onclick="toggleStatCompare()">
        ${statIcon}${statCompareOpen ? 'Hide' : 'Show'} Statistical Comparison
      </button>
    </div>`;
}

function extractDateFromLabel(label){
  const m = label.match(/(\d{2})-(\d{2})-(\d{4})/);
  if(!m) return null;
  return new Date(parseInt(m[3]), parseInt(m[2])-1, parseInt(m[1]));
}

function baseLeverageGroup(label){
  if(/spot/i.test(label)) return 'SPOT';
  const m = label.match(/(\d+(?:\.\d+)?)x/i);
  return m ? m[1]+'x' : null;
}

let progressChartOpen = false;

async function toggleProgressChart(){
  progressChartOpen = !progressChartOpen;
  const section = document.getElementById('progress-section');
  buildCompareToggle();
  if(!progressChartOpen){ section.style.display = 'none'; section.innerHTML = ''; return; }
  section.style.display = 'block';
  renderProgressChart();
}

function renderProgressChart(){
  const section = document.getElementById('progress-section');
  const visible = ORDER.filter(passesFilters);

  // Group by base leverage (3x, 5x, SPOT, ...), each with its dated score points
  const groups = {};
  visible.forEach(lev => {
    const group = baseLeverageGroup(lev);
    const date = extractDateFromLabel(lev);
    if(!group || !date) return; // undated/unrecognized labels can't plot on a timeline
    if(!groups[group]) groups[group] = [];
    groups[group].push({date, score: DATA[lev].total, lev});
  });
  Object.values(groups).forEach(pts => pts.sort((a,b)=> a.date - b.date));

  const plottable = Object.entries(groups).filter(([_, pts]) => pts.length >= 2);
  if(plottable.length === 0){
    section.innerHTML = `<div class="panel" style="margin:14px clamp(20px,5vw,64px) 0;">
      <div class="empty-note">Need at least 2 dated runs at the same leverage to show a trend — only labels with a DD-MM-YYYY date (the current auto-assigned format) can be plotted. Older manually-named runs are skipped.</div>
    </div>`;
    return;
  }

  const W = 1100, H = 340, PAD_L = 50, PAD_R = 140, PAD_T = 20, PAD_B = 36;
  const allDates = plottable.flatMap(([_,pts]) => pts.map(p=>p.date.getTime()));
  const minDate = Math.min(...allDates), maxDate = Math.max(...allDates);
  const dateSpan = (maxDate - minDate) || 1;

  const xFor = t => PAD_L + ((t - minDate) / dateSpan) * (W - PAD_L - PAD_R);
  const yFor = score => H - PAD_B - (score/100) * (H - PAD_T - PAD_B);

  const lines = plottable.map(([group, pts], i) => {
    const color = COMPARE_PALETTE[i % COMPARE_PALETTE.length];
    const d = pts.map((p,j)=> `${j===0?'M':'L'} ${xFor(p.date.getTime()).toFixed(1)} ${yFor(p.score).toFixed(1)}`).join(' ');
    const trend = pts[pts.length-1].score - pts[0].score;
    return { group, color, d, pts, trend, latest: pts[pts.length-1].score };
  });

  const labelCount = 5;
  const xLabels = [];
  for(let i=0;i<=labelCount;i++){
    const t = minDate + dateSpan * (i/labelCount);
    const d = new Date(t);
    xLabels.push(`<text x="${xFor(t)}" y="${H-14}" fill="var(--text-faint)" font-size="10" font-family="var(--mono)" text-anchor="middle">${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}</text>`);
  }

  const legendItems = lines.map(l => `
    <div style="display:flex;align-items:center;gap:8px;padding:6px 0;">
      <span style="width:12px;height:12px;border-radius:3px;background:${l.color};flex-shrink:0;"></span>
      <span style="font-family:var(--mono);font-size:12px;color:var(--text-dim);">${escapeHtml(l.group)}</span>
      <span style="font-family:var(--mono);font-size:11px;color:${l.trend>=0?'var(--green)':'var(--red)'};margin-left:auto;">${l.trend>=0?'+':''}${fmt(l.trend,1)}</span>
    </div>`).join('');

  section.innerHTML = `
    <div class="panel" style="margin:14px clamp(20px,5vw,64px) 0;">
      <div class="panel-label">Score Over Time, by Leverage &mdash; ${plottable.length} group${plottable.length!==1?'s':''} with 2+ dated runs</div>
      <div class="storage-note" style="margin:6px 0 16px;">
        Tracks your best-run score at each leverage across the dates you've actually tested
        it (parsed from the auto-assigned label date) — is a given leverage level trending
        up release over release, or has it plateaued? Change shown is latest minus earliest
        plotted point.
      </div>
      <div style="display:flex;gap:20px;">
        <svg viewBox="0 0 ${W} ${H}" style="flex:1;min-width:400px;height:auto;">
          <line x1="${PAD_L}" y1="${yFor(0)}" x2="${W-PAD_R}" y2="${yFor(0)}" stroke="var(--line)" stroke-width="1" stroke-dasharray="4,4"/>
          <line x1="${PAD_L}" y1="${yFor(100)}" x2="${W-PAD_R}" y2="${yFor(100)}" stroke="var(--line)" stroke-width="1" stroke-dasharray="4,4"/>
          <text x="${PAD_L}" y="${yFor(100)-6}" fill="var(--text-faint)" font-size="10" font-family="var(--mono)">100</text>
          <text x="${PAD_L}" y="${yFor(0)-6}" fill="var(--text-faint)" font-size="10" font-family="var(--mono)">0</text>
          ${lines.map(l => `<path d="${l.d}" fill="none" stroke="${l.color}" stroke-width="2"/>${l.pts.map(p=>`<circle cx="${xFor(p.date.getTime())}" cy="${yFor(p.score)}" r="3" fill="${l.color}"/>`).join('')}`).join('')}
          ${xLabels.join('')}
        </svg>
        <div style="min-width:160px;">
          <div class="panel-label" style="margin-bottom:6px;">Trend</div>
          ${legendItems}
        </div>
      </div>
    </div>`;
}

async function toggleCompareChart(){
  compareChartOpen = !compareChartOpen;
  const section = document.getElementById('compare-section');
  buildCompareToggle();
  if(!compareChartOpen){ section.style.display = 'none'; section.innerHTML = ''; return; }
  section.style.display = 'block';
  section.innerHTML = '<div class="panel" style="margin:14px clamp(20px,5vw,64px) 0;"><div class="empty-note">Loading comparison data&hellip;</div></div>';
  await renderCompareChart();
}

async function renderCompareChart(){
  const section = document.getElementById('compare-section');
  const visible = ORDER.filter(passesFilters);
  if(visible.length < 2){
    section.innerHTML = '<div class="panel" style="margin:14px clamp(20px,5vw,64px) 0;"><div class="empty-note">Need at least 2 visible runs to compare — adjust filters or add more runs.</div></div>';
    return;
  }

  // Fetch day-level data for every visible run in parallel
  const series = await Promise.all(visible.map(async (lev) => {
    try{
      const res = await fetch(`${API}/${encodeURIComponent(lev)}/detail/days`);
      const rows = await res.json();
      if(!rows || rows.length === 0) return { lev, points: null };
      const sorted = [...rows].sort((a,b)=> parseDDMMYYYY(a.day) - parseDDMMYYYY(b.day));
      let cum = 0;
      const points = sorted.map(r => { cum += r.tot_profit_usdt; return { date: parseDDMMYYYY(r.day), cum }; });
      return { lev, points };
    }catch(e){ return { lev, points: null }; }
  }));

  const withData = series.filter(s => s.points && s.points.length > 1);
  const withoutData = series.filter(s => !s.points || s.points.length <= 1);

  if(withData.length < 2){
    section.innerHTML = `<div class="panel" style="margin:14px clamp(20px,5vw,64px) 0;">
      <div class="empty-note">Not enough runs with daily data loaded to compare (need Heatmap/day data for at least 2 runs — load a console log with <code>--breakdown day</code> for each). ${withoutData.length ? `Missing for: ${withoutData.map(s=>escapeHtml(s.lev)).join(', ')}` : ''}</div>
    </div>`;
    return;
  }

  const W = 1100, H = 420, PAD_L = 60, PAD_R = 20, PAD_T = 20, PAD_B = 40;
  const allDates = withData.flatMap(s => s.points.map(p=>p.date.getTime()));
  const allValues = withData.flatMap(s => s.points.map(p=>p.cum));
  const minDate = Math.min(...allDates), maxDate = Math.max(...allDates);
  const minVal = Math.min(0, ...allValues), maxVal = Math.max(...allValues);

  const xFor = t => PAD_L + ((t - minDate) / ((maxDate - minDate) || 1)) * (W - PAD_L - PAD_R);
  const yFor = v => H - PAD_B - ((v - minVal) / ((maxVal - minVal) || 1)) * (H - PAD_T - PAD_B);
  const zeroY = yFor(0);

  const paths = withData.map((s, i) => {
    const color = COMPARE_PALETTE[i % COMPARE_PALETTE.length];
    const d = s.points.map((p,j)=> `${j===0?'M':'L'} ${xFor(p.date.getTime()).toFixed(1)} ${yFor(p.cum).toFixed(1)}`).join(' ');
    return { lev: s.lev, color, d, finalVal: s.points[s.points.length-1].cum };
  });

  // x-axis date labels, sampled evenly
  const labelCount = 6;
  const xLabels = [];
  for(let i=0;i<=labelCount;i++){
    const t = minDate + (maxDate-minDate) * (i/labelCount);
    const d = new Date(t);
    xLabels.push(`<text x="${xFor(t)}" y="${H-16}" fill="var(--text-faint)" font-size="10" font-family="var(--mono)" text-anchor="middle">${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}</text>`);
  }

  const legendItems = paths.map(p => `
    <div class="compare-legend-row" onclick="inspectFromCompare('${escapeAttr(p.lev)}')" title="Click to inspect ${escapeHtml(p.lev)}">
      <span style="width:12px;height:12px;border-radius:3px;background:${p.color};flex-shrink:0;"></span>
      <span class="compare-legend-label">${escapeHtml(p.lev.toUpperCase())}</span>
      <span style="font-family:var(--mono);font-size:11px;color:${p.finalVal>=0?'var(--green)':'var(--red)'};margin-left:auto;flex-shrink:0;">${fmt(p.finalVal,1)}</span>
    </div>`).join('');

  section.innerHTML = `
    <div class="panel" style="margin:14px clamp(20px,5vw,64px) 0;">
      <div class="panel-label">Cumulative Equity Comparison &mdash; ${withData.length} run${withData.length!==1?'s':''}${withoutData.length ? ` (${withoutData.length} skipped, no day data)` : ''}</div>
      <div style="display:flex;gap:20px;margin-top:12px;flex-wrap:wrap;">
        <svg viewBox="0 0 ${W} ${H}" style="flex:1;min-width:400px;height:auto;">
          <line x1="${PAD_L}" y1="${zeroY}" x2="${W-PAD_R}" y2="${zeroY}" stroke="var(--line)" stroke-width="1" stroke-dasharray="4,4"/>
          ${paths.map(p => `<path d="${p.d}" fill="none" stroke="${p.color}" stroke-width="2"/>`).join('')}
          ${xLabels.join('')}
          <text x="${PAD_L}" y="14" fill="var(--text-faint)" font-size="10" font-family="var(--mono)">USDT</text>
        </svg>
        <div style="min-width:180px;">
          <div class="panel-label" style="margin-bottom:6px;">Runs</div>
          ${legendItems}
        </div>
      </div>
    </div>`;
}

let statCompareOpen = false;
let statCompareSelA = null, statCompareSelB = null;

function toggleStatCompare(){
  statCompareOpen = !statCompareOpen;
  const section = document.getElementById('statcompare-section');
  buildCompareToggle();
  if(!statCompareOpen){ section.style.display = 'none'; section.innerHTML = ''; return; }
  section.style.display = 'block';
  if(!statCompareSelA) statCompareSelA = ORDER[0];
  if(!statCompareSelB) statCompareSelB = ORDER.length > 1 ? ORDER[1] : ORDER[0];
  renderStatCompareUI();
}

function meanArr(arr){ return arr.reduce((a,b)=>a+b,0)/arr.length; }
function varianceArr(arr, m){ return arr.length > 1 ? arr.reduce((s,x)=>s+(x-m)**2,0)/(arr.length-1) : 0; }

// Standard normal CDF approximation (Abramowitz & Stegun 26.2.17) — used as an
// approximation to the t-distribution's p-value. Increasingly accurate as sample size
// grows; treated here as reasonable for realistic backtest trade counts (30+ trades),
// not represented as an exact small-sample calculation.
function normalCDF(z){
  const t = 1/(1+0.2316419*Math.abs(z));
  const d = 0.3989423*Math.exp(-z*z/2);
  let p = d*t*(0.3193815+t*(-0.3565638+t*(1.781478+t*(-1.821256+t*1.330274))));
  return z>0 ? 1-p : p;
}

function welchTTest(sampleA, sampleB){
  const nA = sampleA.length, nB = sampleB.length;
  const mA = meanArr(sampleA), mB = meanArr(sampleB);
  const varA = varianceArr(sampleA, mA), varB = varianceArr(sampleB, mB);
  const se = Math.sqrt(varA/nA + varB/nB);
  if(se === 0){
    // Zero within-group variance in both samples — every trade in each group is
    // identical. If the means also match, there's genuinely no difference to detect
    // (t=0, p=1, correctly). But if the means differ, zero internal noise is the
    // strongest possible evidence of a real difference, not the weakest — the
    // earlier version of this function had this backwards, reporting "no difference"
    // for cases like every-trade-is-1% vs every-trade-is-3%, which is about as
    // unambiguous a difference as trade data can show.
    const t = mA === mB ? 0 : (mA > mB ? Infinity : -Infinity);
    const pValue = mA === mB ? 1 : 0;
    return { meanA: mA, meanB: mB, nA, nB, t, pValue };
  }
  const t = (mA - mB) / se;
  const pValue = 2 * (1 - normalCDF(Math.abs(t)));
  return { meanA: mA, meanB: mB, nA, nB, t, pValue };
}

function renderStatCompareUI(){
  const section = document.getElementById('statcompare-section');
  const buildOptions = (selected) => ORDER.map(lev => `<option value="${escapeAttr(lev)}" ${lev===selected?'selected':''}>${escapeHtml(lev)}</option>`).join('');
  section.innerHTML = `
    <div class="panel" style="margin:14px clamp(20px,5vw,64px) 0;">
      <div class="panel-label">Statistical Comparison</div>
      <div class="storage-note" style="margin:6px 0 16px;">
        Tests whether the difference in average per-trade return between two runs is
        statistically meaningful, or within the range you'd expect from noise given how
        many trades each run has. "Run A has a higher average" alone doesn't tell you
        that &mdash; a big gap on a handful of trades can be pure chance, while a small
        gap on hundreds of trades can be a real, repeatable difference. Needs
        trades.json loaded for both runs.
      </div>
      <div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap;margin-bottom:16px;">
        <select id="statcompare-a" onchange="statCompareSelA=this.value;renderStatCompareUI();">${buildOptions(statCompareSelA)}</select>
        <span style="color:var(--text-faint);font-family:var(--mono);font-size:12px;">vs</span>
        <select id="statcompare-b" onchange="statCompareSelB=this.value;renderStatCompareUI();">${buildOptions(statCompareSelB)}</select>
      </div>
      <div id="statcompare-result">Loading trades for both runs...</div>
    </div>`;

  loadAndRunStatCompare(statCompareSelA, statCompareSelB);
}

async function loadAndRunStatCompare(levA, levB){
  const resultEl = document.getElementById('statcompare-result');
  if(!levA || !levB){ resultEl.innerHTML = '<div class="empty-note">Pick two runs to compare.</div>'; return; }
  if(levA === levB){ resultEl.innerHTML = '<div class="empty-note">Pick two different runs to compare.</div>'; return; }

  try{
    const [resA, resB] = await Promise.all([
      fetch(`${API}/${encodeURIComponent(levA)}/detail/trades`),
      fetch(`${API}/${encodeURIComponent(levB)}/detail/trades`)
    ]);
    if(!resA.ok || !resB.ok){
      resultEl.innerHTML = '<div class="empty-note">Both runs need trades.json loaded to run this comparison.</div>';
      return;
    }
    const [tradesA, tradesB] = await Promise.all([resA.json(), resB.json()]);
    if(!tradesA.length || !tradesB.length){
      resultEl.innerHTML = '<div class="empty-note">Both runs need trades.json loaded to run this comparison.</div>';
      return;
    }
    let sampleNote = '';
    if(tradesA.length < 20 || tradesB.length < 20){
      sampleNote = `<div class="empty-note" style="margin-bottom:12px;">At least 20 trades per run recommended for this test to be meaningful &mdash; ${escapeHtml(levA)} has ${tradesA.length}, ${escapeHtml(levB)} has ${tradesB.length}. Result shown, but treat it cautiously with small samples.</div>`;
    }

    const sampleA = tradesA.map(t => t.profit_pct);
    const sampleB = tradesB.map(t => t.profit_pct);
    const result = welchTTest(sampleA, sampleB);

    const verdict = result.pValue < 0.05
      ? {label:'STATISTICALLY SIGNIFICANT DIFFERENCE', color:'var(--green)', note:`The gap in average per-trade return between these two runs is unlikely to be explained by chance alone (p = ${fmt(result.pValue,4)}). ${result.meanA > result.meanB ? escapeHtml(levA) : escapeHtml(levB)} genuinely looks better on this measure, not just luckier.`}
      : {label:'NOT STATISTICALLY SIGNIFICANT', color:'var(--amber)', note:`The gap in average per-trade return (p = ${fmt(result.pValue,4)}) is within the range you'd expect from noise given these trade counts. Whichever run has the higher average here, it's not confidently distinguishable from the other on this measure alone.`};

    document.getElementById('statcompare-result').innerHTML = sampleNote + `
      <div style="display:grid;grid-template-columns:140px 1fr 1fr;gap:16px;font-family:var(--mono);font-size:11px;color:var(--text-faint);margin-bottom:2px;">
        <div></div><div style="text-align:right;">${escapeHtml(levA)}</div><div style="text-align:right;">${escapeHtml(levB)}</div>
      </div>
      <div class="compare-stat-row"><div class="label">Trades</div><div class="val">${result.nA}</div><div class="val">${result.nB}</div></div>
      <div class="compare-stat-row"><div class="label">Mean profit/trade</div><div class="val">${fmt(result.meanA,3)}%</div><div class="val">${fmt(result.meanB,3)}%</div></div>
      <div class="compare-stat-row"><div class="label">t-statistic</div><div class="val" style="grid-column:2/4;">${fmt(result.t,3)}</div></div>
      <div class="compare-stat-row"><div class="label">p-value (two-sided)</div><div class="val" style="grid-column:2/4;">${result.pValue<0.0001?'&lt;0.0001':fmt(result.pValue,4)}</div></div>
      <div style="padding:12px 16px;border-radius:8px;background:var(--panel-raised);border:1px solid ${verdict.color};margin-top:16px;">
        <b style="color:${verdict.color};">${verdict.label}</b>
        <div style="font-size:12.5px;color:var(--text-dim);margin-top:6px;">${verdict.note}</div>
      </div>`;
  }catch(e){
    resultEl.innerHTML = '<div class="empty-note">Could not load trades for one or both runs.</div>';
  }
}
