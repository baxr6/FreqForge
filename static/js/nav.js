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

function render(lev){
  currentLev = lev;
  currentSubTab = 'summary';
  buildSubnav(lev);
  renderRunBanner(lev);
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
      <div class="panel-label">Score Breakdown &mdash; ${escapeHtml(lev.toUpperCase())}</div>
      <div class="score-rows">
        ${row("Profitability (CAGR)", "15%", d.s.cagr, "var(--green)")}
        ${row("Sortino Ratio", "25%", d.s.sortino, "var(--green)")}
        ${row("Drawdown control", "25%", d.s.dd, "var(--green)")}
        ${row("Liquidation safety", "15%", d.s.liq, d.s.liq < 50 ? "var(--red)" : "var(--green)")}
        ${row("Profit Factor", "10%", d.s.pf, d.s.pf < 50 ? "var(--amber)" : "var(--green)")}
        ${row("Worst-trade severity", "10%", d.s.worst, d.s.worst < 50 ? "var(--red)" : "var(--green)")}
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
        <div class="panel-label" style="margin-bottom:10px;">Forced-liquidation rate</div>
        <div class="gauge-track">
          <div class="gauge-needle" style="left:${Math.min(100, d.liq_rate/15*100)}%;"></div>
        </div>
        <div class="gauge-labels"><span>0%</span><span>SAFE&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;CAUTION&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;DANGER</span><span>15%</span></div>
        <div style="margin-top:12px;font-family:var(--mono);font-size:22px;font-weight:600;color:${d.liq_rate>10?'var(--red)':d.liq_rate>2?'var(--amber)':'var(--green)'}">${fmt(d.liq_rate,2)}%</div>
        <div style="font-size:11.5px;color:var(--text-faint);margin-top:2px;">of ${d.trades} total trades</div>
      </div>
    </div>
  `;
  document.getElementById('submain').innerHTML = '';
}

