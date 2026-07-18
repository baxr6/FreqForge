const COMPARE_PALETTE = ['#8b5cf6','#3ea1ff','#3ddc84','#f0a83c','#ef5164','#e879f9','#22d3ee','#facc15','#fb923c','#a3e635'];
let compareChartOpen = false;

function refreshCompareUI(){
  buildCompareToggle();
  if(compareChartOpen) renderCompareChart();
}

function buildCompareToggle(){
  const wrap = document.getElementById('compare-toggle-wrap');
  if(ORDER.length < 2){ wrap.innerHTML = ''; return; }
  const visibleCount = ORDER.filter(passesFilters).length;
  wrap.innerHTML = `
    <div style="margin:14px clamp(20px,5vw,64px) 0;">
      <button class="btn secondary" onclick="toggleCompareChart()">
        &#128202; ${compareChartOpen ? 'Hide' : 'Show'} Comparison Chart ${activeExchangeFilter!=='all'||activeVersionFilter!=='all' ? `(${visibleCount} filtered runs)` : `(all ${visibleCount} runs)`}
      </button>
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
    <div style="display:flex;align-items:center;gap:8px;padding:6px 0;cursor:pointer;" onclick="render('${escapeAttr(p.lev)}')" title="Click to inspect ${escapeHtml(p.lev)}">
      <span style="width:12px;height:12px;border-radius:3px;background:${p.color};flex-shrink:0;"></span>
      <span style="font-family:var(--mono);font-size:12px;color:var(--text-dim);">${escapeHtml(p.lev.toUpperCase())}</span>
      <span style="font-family:var(--mono);font-size:11px;color:${p.finalVal>=0?'var(--green)':'var(--red)'};margin-left:auto;">${fmt(p.finalVal,1)}</span>
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
