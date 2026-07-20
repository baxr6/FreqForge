function selectLeverage(lev){
  // Switching leverage (via history row, tab, or badge click) should stay on whatever
  // subtab you're currently viewing — Grind Analysis, Pairs, etc — not silently reset to
  // Summary. render() itself always resets to Summary as a clean base, so capture the
  // subtab first and re-apply it for the new leverage if it wasn't Summary already.
  const subTabToRestore = currentSubTab;
  render(lev);
  if(subTabToRestore && subTabToRestore !== 'summary'){
    switchSubTab(lev, subTabToRestore);
  }
}

let robustnessCache = {};

async function checkRobustnessQuick(lev){
  if(robustnessCache[lev] !== undefined) return robustnessCache[lev]; // already computed this session

  try{
    const res = await fetch(`${API}/${encodeURIComponent(lev)}/detail/trades`);
    if(!res.ok){ robustnessCache[lev] = null; return null; }
    const trades = await res.json();
    if(!trades || trades.length < 10){ robustnessCache[lev] = null; return null; }

    const runMeta = DATA[lev];
    const startingEquity = (runMeta && runMeta.deposit) ? runMeta.deposit : 500;
    const sorted = [...trades].sort((a,b) => new Date(a.open_date) - new Date(b.open_date));
    const profitSeq = sorted.map(t => t.profit_abs || 0);
    const actualDD = maxDrawdownPctFromSequence(profitSeq, startingEquity);

    // Reduced simulation count (300 vs the Monte Carlo tab's 1000) — this is a fast
    // background check for "does this deserve a warning badge", not a precise
    // percentile display. The full tab still runs its own 1000-simulation pass.
    const N = 300;
    const simulatedDDs = [];
    for(let i=0;i<N;i++) simulatedDDs.push(maxDrawdownPctFromSequence(fisherYatesShuffle(profitSeq), startingEquity));
    const worseThanActual = simulatedDDs.filter(dd => dd > actualDD).length;
    const percentile = (worseThanActual / N) * 100;
    // Percentile alone isn't enough — with low-variance trade data, simulations can tie
    // with the actual result, making "worse than 0%" true by definition even though a
    // near-zero drawdown is objectively fine. Only flag if the drawdown is also
    // meaningfully large in absolute terms, not just poorly ranked against ties.
    const mcConcerning = percentile <= 20 && actualDD > 3;

    let ioConcerning = false;
    if(trades.length >= 10){
      const splitIdx = Math.floor(sorted.length * 0.8);
      const inSample = sorted.slice(0, splitIdx);
      const outSample = sorted.slice(splitIdx);
      if(outSample.length >= 3){
        const inProfit = inSample.reduce((s,t)=>s+(t.profit_abs||0),0);
        const outProfit = outSample.reduce((s,t)=>s+(t.profit_abs||0),0);
        ioConcerning = outProfit < 0 && inProfit > 0;
      }
    }

    const result = (mcConcerning || ioConcerning)
      ? { concerning: true, mcConcerning, ioConcerning }
      : { concerning: false };
    robustnessCache[lev] = result;
    return result;
  }catch(e){
    robustnessCache[lev] = null;
    return null;
  }
}

function triggerRobustnessCheck(lev){
  checkRobustnessQuick(lev).then(result => {
    // Guard against a stale async result landing after the user already navigated
    // to a different run — only apply the badge if we're still looking at this one.
    if(currentLev !== lev || !result || !result.concerning) return;
    const banner = document.querySelector('.run-banner');
    if(!banner || banner.querySelector('.robustness-warn-badge')) return; // already shown or banner gone
    const reasons = [];
    if(result.mcConcerning) reasons.push('drawdown may be luck of trade ordering');
    if(result.ioConcerning) reasons.push('performance did not hold up out-of-sample');
    const badge = document.createElement('span');
    badge.className = 'rb-badge robustness-warn-badge';
    badge.style.cssText = 'background:rgba(240,168,60,0.12);color:var(--amber);border-color:var(--amber);cursor:pointer;';
    badge.title = `Click to open Monte Carlo tab — ${reasons.join('; ')}`;
    badge.innerHTML = '&#9888; ROBUSTNESS CHECK';
    badge.onclick = () => switchSubTab(lev, 'montecarlo');
    const editBtn = banner.querySelector('.del-btn');
    if(editBtn) editBtn.insertAdjacentElement('beforebegin', badge);
  });
}

function render(lev){
  currentLev = lev;
  currentSubTab = 'summary';
  buildSubnav(lev);
  renderRunBanner(lev);
  triggerRobustnessCheck(lev);
  const d = DATA[lev];
  document.querySelectorAll('.lev-tab').forEach(b=> b.classList.toggle('active', b.dataset.lev===lev));
  document.querySelectorAll('#history-body tr').forEach(r=> r.classList.toggle('row-active', r.dataset.lev===lev));

  const gcolor = GRADE_COLOR[d.grade];
  const caption = autoCaption(lev, d);

  document.getElementById('main').innerHTML = `
    <div class="panel grade-dial">
      <div class="panel-label">Composite Grade</div>
      <div style="position:relative;display:flex;align-items:center;justify-content:center;">
        ${dialSVG(d.total, d.grade)}
        <div style="position:absolute;display:flex;flex-direction:column;align-items:center;">
          <div class="dial-letter" style="color:${gcolor}">${d.grade}</div>
          <div class="dial-score">${d.total.toFixed(1)} / 100</div>
        </div>
      </div>
      <div class="dial-caption">${caption}</div>
    </div>

    <div class="panel">
      <div class="panel-label">Score Breakdown &mdash; ${escapeHtml(lev.toUpperCase())}${d.market_type === 'spot' ? ' <span class="rb-badge" style="background:var(--brand-b-dim,rgba(62,161,255,.12));color:var(--brand-b);border-color:var(--brand-b);">SPOT</span>' : ''}</div>
      <div class="score-rows">
        ${row("Profitability (CAGR)", fmt(d.effectiveWeights.cagr,0)+"%", d.s.cagr, "var(--green)",
          d.leverageMultiplier > 1 ? `${fmt(d.cagr,0)}% raw &divide; ${d.leverageMultiplier}x leverage = ${fmt(d.delevered_cagr,0)}% de-levered` : '')}
        ${row("Sortino Ratio", fmt(d.effectiveWeights.sortino,0)+"%", d.s.sortino, "var(--green)")}
        ${row("Drawdown control", fmt(d.effectiveWeights.dd,0)+"%", d.s.dd, "var(--green)")}
        ${d.s.liq == null
          ? `<div class="score-row"><span class="label">Liquidation safety</span><span class="weight">N/A &mdash; spot</span><span class="val" style="color:var(--text-faint);">Not applicable, can't be liquidated without leverage</span></div>`
          : row("Liquidation safety", fmt(d.effectiveWeights.liq,0)+"%", d.s.liq, d.s.liq < 50 ? "var(--red)" : "var(--green)")}
        ${row("Profit Factor", fmt(d.effectiveWeights.pf,0)+"%", d.s.pf, d.s.pf < 50 ? "var(--amber)" : "var(--green)")}
        ${row("Worst-trade severity", fmt(d.effectiveWeights.worst,0)+"%", d.s.worst, d.s.worst < 50 ? "var(--red)" : "var(--green)")}
      </div>
      <div class="stat-grid" style="margin-top:26px;">
        <div class="stat"><div class="k">Total / Cagr</div><div class="v">${fmt(d.cagr,1)}%</div></div>
        <div class="stat"><div class="k">Sortino (weighted)</div><div class="v">${d.sortino<=-50 ? 'n/a*' : fmt(d.sortino,2)}</div></div>
        <div class="stat"><div class="k">Sharpe (reference only)</div><div class="v" style="color:var(--text-faint);">${fmt(d.sharpe,2)}</div></div>
        <div class="stat"><div class="k">Calmar</div><div class="v">${fmtInt(d.calmar.toFixed(0))}</div></div>
        <div class="stat ${d.maxdd>10?'neg':d.maxdd>2?'warn':''}"><div class="k">Max Drawdown</div><div class="v">${fmt(d.maxdd,2)}%</div></div>
        <div class="stat"><div class="k">Profit Factor</div><div class="v">${fmt(d.pf,1)}</div></div>
        <div class="stat"><div class="k">SQN</div><div class="v">${fmt(d.sqn,2)}</div></div>
        <div class="stat" title="Average $ profit expected per trade. More intuitive than Profit Factor for 'is this worth trading' — a strategy can have a great PF but tiny per-trade expectancy.">
          <div class="k">Expectancy</div>
          <div class="v ${d.expectancy==null ? '' : d.expectancy>=0 ? 'pos' : 'neg'}">${d.expectancy==null ? 'needs trades.json' : '$'+fmt(d.expectancy,2)}</div>
        </div>
        <div class="stat" title="Two-sided p-value: is the average per-trade profit distinguishable from zero, or could it be noise? Below 0.05 is the conventional significance bar. Caveat: assumes independent trades (real strategies rarely are), and a low value alone isn't proof of genuine edge.">
          <div class="k">Mean-profit p-value</div>
          <div class="v" style="color:${d.p_value==null ? 'var(--text-faint)' : d.p_value<0.05 ? 'var(--green)' : 'var(--amber)'};">
            ${d.p_value==null ? 'needs trades.json' : d.p_value<0.001 ? '&lt;0.001' : fmt(d.p_value,4)}
          </div>
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-label">Risk Instrument</div>
      <div class="stat-grid" style="grid-template-columns:1fr;">
        <div class="stat ${d.worst_trade < -50 ? 'neg':''}"><div class="k">Worst single trade</div><div class="v">${fmt(d.worst_trade,2)}%</div></div>
        <div class="stat ${d.lose_days>5?'neg':''}"><div class="k">Losing days / total</div><div class="v">${d.lose_days} <span style="color:var(--text-faint);font-size:13px;">of ${d.win_days+d.lose_days}</span></div></div>
        <div class="stat" title="Longest run of consecutive winning trades, then losing trades. Relevant to capital/drawdown-tolerance planning beyond aggregate stats — two strategies with identical overall numbers can feel very different to trade if one has much longer losing streaks.">
          <div class="k">Longest win / loss streak</div>
          <div class="v">
            <span class="pos">${d.max_consecutive_wins==null ? '?' : fmtInt(d.max_consecutive_wins)}</span>
            <span style="color:var(--text-faint);"> / </span>
            <span class="${(d.max_consecutive_losses||0)>5?'neg':''}">${d.max_consecutive_losses==null ? '?' : fmtInt(d.max_consecutive_losses)}</span>
            ${d.max_consecutive_wins==null ? '<span style="color:var(--text-faint);font-size:12px;"> needs trades.json</span>' : ''}
          </div>
        </div>
        <div class="stat" title="Average time winning trades stay open vs losing trades. A big asymmetry is a real signal about how the strategy wins — e.g. cutting losses fast while letting winners run, or the opposite.">
          <div class="k">Avg hold: winners / losers</div>
          <div class="v" style="font-size:15px;">
            ${d.winner_holding_avg ? `<span class="pos">${escapeHtml(d.winner_holding_avg)}</span>` : '<span style="color:var(--text-faint);">needs trades.json</span>'}
            ${d.winner_holding_avg && d.loser_holding_avg ? ` <span style="color:var(--text-faint);">/</span> <span class="neg">${escapeHtml(d.loser_holding_avg)}</span>` : ''}
          </div>
        </div>
        <div class="stat"><div class="k">Final balance (500 start)</div><div class="v" style="color:var(--green);">$${fmtInt(d.final_bal.toFixed(0))}</div></div>
      </div>
      <div class="gauge-wrap">
        ${d.market_type === 'spot' ? `
          <div class="panel-label" style="margin-bottom:10px;">Forced-liquidation rate</div>
          <div style="padding:20px 0;text-align:center;color:var(--text-faint);font-family:var(--mono);font-size:13px;">
            Not applicable &mdash; spot trading has no leverage, so liquidation is structurally impossible.
          </div>
        ` : `
          <div class="panel-label" style="margin-bottom:10px;">Forced-liquidation rate</div>
          <div class="gauge-track">
            <div class="gauge-needle" style="left:${Math.min(100, d.liq_rate/15*100)}%;"></div>
          </div>
          <div class="gauge-labels"><span>0%</span><span>SAFE&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;CAUTION&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;DANGER</span><span>15%</span></div>
          <div style="margin-top:12px;font-family:var(--mono);font-size:22px;font-weight:600;color:${d.liq_rate>10?'var(--red)':d.liq_rate>2?'var(--amber)':'var(--green)'}">${fmt(d.liq_rate,2)}%</div>
          <div style="font-size:11.5px;color:var(--text-faint);margin-top:2px;">of ${d.trades} total trades</div>
        `}
      </div>
    </div>
  `;
  document.getElementById('submain').innerHTML = '';
}

