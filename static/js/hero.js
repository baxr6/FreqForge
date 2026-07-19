function renderMethodologyText(){
  const c = SCORING_CONFIG;
  const el = document.getElementById('methodology-text');
  if(!el) return;
  el.innerHTML = `
    <b>Methodology (v3).</b> Each run is scored against fixed, absolute thresholds &mdash; never relative to other runs, so a grade can't shift just because you added or removed a different leverage level.
    <b>Sortino:</b> 0&rarr;0pts, ${c.sortino_acceptable} ("acceptable" gate)&rarr;50pts, ${c.sortino_strong}+ ("strong")&rarr;100pts; freqtrade's broken <code>-100.00</code> sentinel scores 100 (no downside deviation observed, not a real negative).
    <b>Drawdown:</b> 0%&rarr;100pts, ${c.drawdown_strong_at}% ("strong")&rarr;90pts, 20%&rarr;50pts, ${c.drawdown_zero_score_at}%&rarr;0pts.
    <b>CAGR:</b> log-scaled, 100%&rarr;50pts, ${fmtInt(c.cagr_max_threshold)}%+&rarr;100pts. <b>De-levered before scoring</b> &mdash; a 5x run's raw CAGR is divided by 5 first, so leverage-amplified returns aren't compared directly against unleveraged (spot) or lower-leverage runs on an unfair basis. This is an approximation (volatility drag means realized leveraged returns usually undershoot a clean N&times; multiple), not an exact conversion, but it removes the dominant distortion. Spot runs are unaffected (1x, unchanged).
    <b>Liquidation-safety:</b> forced-exit rate (liquidations + near-total stoplosses, % of trades), 0%&rarr;100pts, ${c.liquidation_zero_score_at}%+&rarr;0pts &mdash; no published equivalent exists since this risk is specific to leverage. <b>Spot runs skip this category entirely</b> (structurally can't be liquidated without leverage) and have its weight redistributed proportionally across the other five, rather than being scored on a risk that can't occur.
    <b>Profit Factor:</b> 1.0&rarr;20pts, 2.0&rarr;70pts, ${c.pf_max_threshold}+&rarr;100pts.
    <b>Worst-trade severity:</b> 100+worst_trade_pct, so a -100% trade scores 0 regardless of how good the average looks.
    Calmar was evaluated and deliberately excluded &mdash; at this leverage scale every run's Calmar sits thousands of times past any "strong" threshold, adding no differentiation, and it's already redundant with scoring CAGR and Drawdown separately.
    These thresholds are opinionated, not universal &mdash; there is no single industry-standard formula (confirmed across institutional and prop-trading sources) &mdash; but every input is shown above, and every threshold and weight is editable via &#9881; Settings, so you can tune the weighting to your own judgment rather than accept a fixed default.
  `;
}

function renderHero(){
  document.getElementById('hero-generated').textContent = new Date().toLocaleString('en-AU', {dateStyle:'medium', timeStyle:'short'});

  const w = SCORING_CONFIG.weights;
  const labels = {sortino:'Sortino', dd:'Drawdown', cagr:'CAGR', liq:'Liquidation-safety', pf:'Profit Factor', worst:'Worst-trade severity'};
  const formulaOrder = ['sortino','dd','cagr','liq','pf','worst'];
  document.getElementById('formula-text').textContent = formulaOrder.map(k => `${labels[k]} ${w[k]}%`).join(' · ');
  renderMethodologyText();

  if(ORDER.length === 0){
    document.getElementById('banner-stats').innerHTML = '';
    document.getElementById('hero-badges').innerHTML = '<span class="badge">NO DATA YET</span>';
    return;
  }

  const sorted = [...ORDER].sort((a,b)=> DATA[b].total - DATA[a].total);
  const best = sorted[0], worst = sorted[sorted.length-1];
  const bestD = DATA[best], worstD = DATA[worst];

  const dayWinRate = (bestD.win_days+bestD.lose_days) > 0 ? bestD.win_days/(bestD.win_days+bestD.lose_days)*100 : 0;
  document.getElementById('banner-stats').innerHTML = `
    <div class="bstat"><div class="bk">Total Return</div><div class="bv" style="color:var(--green)">+${fmt(bestD.cagr,1)}%</div><div class="bs">CAGR (${best.toUpperCase()})</div></div>
    <div class="bstat"><div class="bk">Day Win Rate</div><div class="bv" style="color:var(--brand-b)">${fmt(dayWinRate,1)}%</div><div class="bs">${bestD.win_days}/${bestD.win_days+bestD.lose_days} days</div></div>
    <div class="bstat"><div class="bk">Profit Factor</div><div class="bv">${fmt(bestD.pf,2)}</div><div class="bs">gross profit/loss</div></div>
    <div class="bstat"><div class="bk">Max Drawdown</div><div class="bv" style="color:${bestD.maxdd>10?'var(--red)':'var(--amber)'}">-${fmt(bestD.maxdd,2)}%</div><div class="bs">peak to valley</div></div>
  `;

  const liqFreeCounts = ORDER.filter(k => DATA[k].market_type !== 'spot' && DATA[k].liq_rate === 0).length;
  const marketTypes = new Set(ORDER.map(k => DATA[k].market_type || 'unknown'));
  const marketBadge = marketTypes.size > 1 ? 'MIXED MARKETS'
    : marketTypes.has('spot') ? 'SPOT'
    : marketTypes.has('futures') ? 'FUTURES'
    : 'MARKET: UNKNOWN';
  const gradeBadges = ORDER.length === 1
    ? `<span class="badge accent grade-badge" style="cursor:pointer;" onclick="render('${escapeAttr(best)}')" title="${escapeHtml(best)}">GRADE ${bestD.grade}</span>`
    : `<span class="badge accent grade-badge" style="cursor:pointer;" onclick="render('${escapeAttr(best)}')" title="${escapeHtml(best)}">BEST ${bestD.grade}</span>
       <span class="badge ${worstD.grade[0]==='F'||worstD.grade[0]==='D' ? 'warn' : ''} grade-badge" style="cursor:pointer;" onclick="render('${escapeAttr(worst)}')" title="${escapeHtml(worst)}">WORST ${worstD.grade}</span>`;
  document.getElementById('hero-badges').innerHTML = `
    <span class="badge">${marketBadge}</span>
    <span class="badge">${ORDER.length} RUN${ORDER.length!==1?'S':''} TRACKED</span>
    ${gradeBadges}
    ${liqFreeCounts ? `<span class="badge accent">${liqFreeCounts} LIQUIDATION-FREE</span>` : ''}
  `;
}

