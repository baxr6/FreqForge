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

  const verdict = percentile >= 80
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
