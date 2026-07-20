function maxDrawdownPctFromSequence(profitSequence, startingEquity){
  let equity = startingEquity, peak = startingEquity, maxDD = 0;
  for(const p of profitSequence){
    equity += p;
    if(equity > peak) peak = equity;
    const dd = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
    if(dd > maxDD) maxDD = dd;
  }
  return maxDD;
}

function fisherYatesShuffle(arr){
  const a = [...arr];
  for(let i = a.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function computeSplitStats(trades, startingEquity){
  const wins = trades.filter(t => t.profit_abs > 0);
  const losses = trades.filter(t => t.profit_abs <= 0);
  const grossWin = wins.reduce((s,t)=>s+t.profit_abs, 0);
  const grossLoss = Math.abs(losses.reduce((s,t)=>s+t.profit_abs, 0));
  const totalProfit = trades.reduce((s,t)=>s+t.profit_abs, 0);
  return {
    count: trades.length,
    totalProfit,
    totalProfitPct: startingEquity ? (totalProfit/startingEquity)*100 : 0,
    winRate: trades.length ? (wins.length/trades.length)*100 : 0,
    profitFactor: grossLoss > 0 ? grossWin/grossLoss : (grossWin > 0 ? Infinity : 0),
    maxDD: maxDrawdownPctFromSequence(trades.map(t=>t.profit_abs), startingEquity)
  };
}

function renderInOutSample(trades, runMeta){
  if(!trades || trades.length < 10){
    return '<div class="empty-note">Need at least 10 trades with trades.json loaded for a meaningful in-sample/out-of-sample split.</div>';
  }
  const sorted = [...trades].sort((a,b) => new Date(a.open_date) - new Date(b.open_date));
  const splitIdx = Math.floor(sorted.length * 0.8);
  const inSample = sorted.slice(0, splitIdx);
  const outSample = sorted.slice(splitIdx);
  if(outSample.length < 3){
    return '<div class="empty-note">Not enough trades in the final 20% for a meaningful out-of-sample comparison.</div>';
  }

  const startingEquity = (runMeta && runMeta.deposit) ? runMeta.deposit : 500;
  const inStats = computeSplitStats(inSample, startingEquity);
  const midEquity = startingEquity + inStats.totalProfit;
  const outStats = computeSplitStats(outSample, midEquity);

  const pfDegraded = isFinite(inStats.profitFactor) && isFinite(outStats.profitFactor) && outStats.profitFactor < inStats.profitFactor * 0.6;
  const wentNegative = outStats.totalProfit < 0 && inStats.totalProfit > 0;
  const verdict = wentNegative
    ? {label: 'PERFORMANCE DID NOT HOLD UP', color: 'var(--red)', note: 'The strategy was profitable on the first 80% of this period but lost money on the most recent 20%. Worth investigating whether this reflects genuine strategy decay, a market regime shift, or overfitting to the earlier period.'}
    : pfDegraded
    ? {label: 'MEANINGFUL DEGRADATION', color: 'var(--amber)', note: 'Profit factor dropped substantially in the most recent 20% of trades compared to the earlier period. Still profitable, but performance is trending weaker, not stronger.'}
    : {label: 'PERFORMANCE HELD UP', color: 'var(--green)', note: 'The most recent 20% of trades performed comparably to (or better than) the earlier 80%. No sign of the strategy degrading toward the end of this backtest window.'};

  const statRow = (label, inVal, outVal) => `
    <div class="compare-stat-row">
      <div class="label">${label}</div>
      <div class="val">${inVal}</div>
      <div class="val">${outVal}</div>
    </div>`;

  return `
    <div class="panel">
      <div class="panel-label">In-Sample vs Out-of-Sample</div>
      <div class="storage-note" style="margin:6px 0 16px;">
        Splits your trades chronologically &mdash; first 80% ("in-sample") vs the most recent 20%
        ("out-of-sample") &mdash; and compares performance across the split. A strategy that looks
        great overall but only because of strong early performance, with the tail end
        quietly losing money, is a common way backtests overstate what to expect going forward.
      </div>
      <div style="display:grid;grid-template-columns:140px 1fr 1fr;gap:16px;font-family:var(--mono);font-size:11px;color:var(--text-faint);margin-bottom:2px;">
        <div></div>
        <div style="text-align:right;">IN-SAMPLE (first 80%)</div>
        <div style="text-align:right;">OUT-OF-SAMPLE (last 20%)</div>
      </div>
      <div>
        ${statRow('Trades', inStats.count, outStats.count)}
        ${statRow('Total profit', fmt(inStats.totalProfit,2)+' ('+fmt(inStats.totalProfitPct,1)+'%)', fmt(outStats.totalProfit,2)+' ('+fmt(outStats.totalProfitPct,1)+'%)')}
        ${statRow('Win rate', fmt(inStats.winRate,1)+'%', fmt(outStats.winRate,1)+'%')}
        ${statRow('Profit factor', isFinite(inStats.profitFactor)?fmt(inStats.profitFactor,2):'&infin;', isFinite(outStats.profitFactor)?fmt(outStats.profitFactor,2):'&infin;')}
        ${statRow('Max drawdown', fmt(inStats.maxDD,2)+'%', fmt(outStats.maxDD,2)+'%')}
      </div>
      <div style="padding:12px 16px;border-radius:8px;background:var(--panel-raised);border:1px solid ${verdict.color};margin-top:16px;">
        <b style="color:${verdict.color};">${verdict.label}</b>
        <div style="font-size:12.5px;color:var(--text-dim);margin-top:6px;">${verdict.note}</div>
      </div>
    </div>`;
}

function renderMonteCarlo(trades, runMeta){
  if(!trades || trades.length < 5){
    return '<div class="empty-note">Need at least 5 trades with trades.json loaded to run a meaningful simulation.</div>';
  }

  // Preserve the trades' actual recorded order (by open_date) — this is the "actual"
  // sequence we compare every random reshuffle against.
  const ordered = [...trades].sort((a,b) => new Date(a.open_date) - new Date(b.open_date));
  const profitSeq = ordered.map(t => t.profit_abs || 0);
  const startingEquity = (runMeta && runMeta.deposit) ? runMeta.deposit : 500;

  const actualDD = maxDrawdownPctFromSequence(profitSeq, startingEquity);

  const N = 1000;
  const simulatedDDs = [];
  for(let i=0; i<N; i++){
    simulatedDDs.push(maxDrawdownPctFromSequence(fisherYatesShuffle(profitSeq), startingEquity));
  }
  simulatedDDs.sort((a,b)=>a-b);

  const worseThanActual = simulatedDDs.filter(dd => dd > actualDD).length;
  const percentile = (worseThanActual / N) * 100;

  const p5 = simulatedDDs[Math.floor(N*0.05)];
  const p50 = simulatedDDs[Math.floor(N*0.50)];
  const p95 = simulatedDDs[Math.floor(N*0.95)];

  const verdict = actualDD <= 3
    ? {label: 'DRAWDOWN NEGLIGIBLE', color: 'var(--green)', note: 'Max drawdown is low enough in absolute terms that ordering luck barely matters here — even a worse-than-typical reshuffle wouldn\'t represent meaningful risk. Percentile ranking isn\'t very informative this close to zero.'}
    : percentile >= 80
    ? {label: 'FAVORABLE ORDERING', color: 'var(--amber)', note: 'Your actual drawdown was better than nearly all random orderings of these same trades — the sequence you happened to get was unusually kind. Treat the reported max drawdown as an optimistic case: a different (equally likely) ordering could plausibly show notably worse risk than this backtest suggests.'}
    : percentile <= 20
    ? {label: 'UNFAVORABLE ORDERING', color: 'var(--brand-b)', note: 'Your actual drawdown was worse than nearly all random orderings of these same trades — this backtest happened to hit a genuinely tough sequence. Typical risk for this trade set (across how these trades could have landed) looks better than what this one run reported, though the tough sequence did really happen.'}
    : {label: 'TYPICAL ORDERING', color: 'var(--green)', note: 'Your actual drawdown sits within the normal range of random orderings — not a fluke in either direction. The reported max drawdown is a reasonable, representative estimate of what to expect.'};

  // histogram of simulated DD distribution
  const bucketCount = 20;
  const minDD = simulatedDDs[0], maxDD = simulatedDDs[N-1];
  const range = (maxDD - minDD) || 1;
  const buckets = new Array(bucketCount).fill(0);
  simulatedDDs.forEach(dd => {
    const idx = Math.min(bucketCount-1, Math.floor((dd - minDD) / range * bucketCount));
    buckets[idx]++;
  });
  const maxBucket = Math.max(...buckets);
  const actualBucketIdx = Math.min(bucketCount-1, Math.floor((actualDD - minDD) / range * bucketCount));

  return `
    <div class="panel" style="margin-bottom:20px;">
      <div class="panel-label">Monte Carlo Trade-Reshuffling &mdash; ${N} simulations</div>
      <div class="storage-note" style="margin:6px 0 16px;">
        Same ${profitSeq.length} trades, ${N} random orderings. Total profit is identical in every
        simulation &mdash; only the <i>sequence</i> changes, which changes the drawdown path. This tests
        whether your actual max drawdown reflects genuine strategy risk, or was partly luck of which
        order the wins and losses happened to land in.
      </div>
      <div class="stat-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:18px;">
        <div class="stat"><div class="k">Your actual Max DD</div><div class="v">${fmt(actualDD,2)}%</div></div>
        <div class="stat"><div class="k">Simulated median Max DD</div><div class="v">${fmt(p50,2)}%</div></div>
        <div class="stat"><div class="k">Percentile (higher = luckier)</div><div class="v" style="color:${verdict.color};">${fmt(percentile,0)}%</div></div>
      </div>
      <div style="padding:12px 16px;border-radius:8px;background:var(--panel-raised);border:1px solid ${verdict.color};margin-bottom:18px;">
        <b style="color:${verdict.color};">${verdict.label}</b>
        <div style="font-size:12.5px;color:var(--text-dim);margin-top:6px;">${verdict.note}</div>
      </div>

      <div class="panel-label" style="margin-bottom:8px;">Distribution of simulated Max Drawdown</div>
      <div style="display:flex;align-items:flex-end;gap:2px;height:110px;">
        ${buckets.map((count,i)=>{
          const h = Math.max(2, (count/maxBucket)*95);
          const isActual = i === actualBucketIdx;
          return `<div style="flex:1;height:${h}px;background:${isActual?'var(--brand-b)':'var(--panel-raised)'};border:1px solid ${isActual?'var(--brand-b)':'var(--line)'};border-radius:2px 2px 0 0;" title="${fmt(minDD+range*i/bucketCount,1)}% - ${fmt(minDD+range*(i+1)/bucketCount,1)}%: ${count} sims"></div>`;
        }).join('')}
      </div>
      <div style="display:flex;justify-content:space-between;font-family:var(--mono);font-size:10px;color:var(--text-faint);margin-top:6px;">
        <span>${fmt(minDD,1)}%</span>
        <span style="color:var(--brand-b);">&#9650; your actual result</span>
        <span>${fmt(maxDD,1)}%</span>
      </div>

      <div class="stat-grid" style="grid-template-columns:repeat(3,1fr);margin-top:18px;">
        <div class="stat"><div class="k">5th percentile (best case)</div><div class="v pos">${fmt(p5,2)}%</div></div>
        <div class="stat"><div class="k">50th percentile (typical)</div><div class="v">${fmt(p50,2)}%</div></div>
        <div class="stat"><div class="k">95th percentile (worst case)</div><div class="v neg">${fmt(p95,2)}%</div></div>
      </div>
    </div>`;
}
