function clamp(x){ return Math.max(0, Math.min(100, x)); }

function lerp(x, points){
  if(x <= points[0][0]) return points[0][1];
  if(x >= points[points.length-1][0]) return points[points.length-1][1];
  for(let i=0;i<points.length-1;i++){
    const [x0,y0]=points[i], [x1,y1]=points[i+1];
    if(x>=x0 && x<=x1) return y0 + (y1-y0)*(x-x0)/(x1-x0);
  }
}

function scoreCagr(cagr){
  const mult = 100 / Math.log10(SCORING_CONFIG.cagr_max_threshold);
  return clamp(mult * Math.log10(Math.max(cagr, 1))); // 100%->50 always; cagr_max_threshold->100
}
function scoreSortino(sortino){
  if(sortino <= -50) return 100; // broken -100 sentinel = no downside deviation observed = excellent
  return clamp(lerp(sortino, [[0,0],[SCORING_CONFIG.sortino_acceptable,50],[SCORING_CONFIG.sortino_strong,100]]));
}
function scoreDrawdown(maxdd){
  return clamp(lerp(maxdd, [[0,100],[SCORING_CONFIG.drawdown_strong_at,90],[20,50],[SCORING_CONFIG.drawdown_zero_score_at,0]]));
}
function scoreLiquidation(rate){
  return clamp(100 - rate*(100/SCORING_CONFIG.liquidation_zero_score_at));
}
function scorePF(pf, sortino){
  // A profit factor of exactly 0.00 usually means a genuinely bad run — but if it
  // coincides with Sortino's broken -100 sentinel, that's not two separate problems,
  // it's the same one: zero losing trades makes both ratios divide by zero. freqtrade
  // defaults PF to 0.00 in that case (mathematically undefined, not "no profit").
  // A perfect win rate should score as excellent, not as if every trade lost money.
  if(pf === 0 && sortino !== undefined && sortino <= -50) return 100;
  return clamp(lerp(pf, [[1.0,20],[1.5,50],[2.0,70],[5.0,90],[SCORING_CONFIG.pf_max_threshold,100]]));
}
function scoreWorstTrade(worstPct){
  return clamp(100 + worstPct); // worstPct is negative, e.g. -6.37 -> 93.63, -100.4 -> 0
}

function extractLeverageForSort(label){
  // Leverage no longer has to be at the start of the label (e.g. "NFIx7-3x-v17.4.413"),
  // so pull the first N-followed-by-x pattern out instead of assuming a leading number.
  const m = label.match(/(\d+(?:\.\d+)?)x/i);
  return m ? parseFloat(m[1]) : parseFloat(label); // fall back to old behavior for odd labels
}

function recompute(){
  ORDER = Object.keys(RUNS).sort((a,b)=> extractLeverageForSort(a) - extractLeverageForSort(b));
  if(ORDER.length===0){ DATA={}; return; }

  const W = SCORING_CONFIG.weights;

  DATA = {};
  ORDER.forEach(k=>{
    const r = RUNS[k];
    const liq_rate = r.trades>0 ? (r.liq_count+r.sl_count)/r.trades*100 : 0;
    const s = {
      cagr: scoreCagr(r.cagr),
      sortino: scoreSortino(r.sortino),
      dd: scoreDrawdown(r.maxdd),
      liq: scoreLiquidation(liq_rate),
      pf: scorePF(r.pf, r.sortino),
      worst: scoreWorstTrade(r.worst_trade)
    };
    const total = (s.cagr*W.cagr + s.sortino*W.sortino + s.dd*W.dd + s.liq*W.liq + s.pf*W.pf + s.worst*W.worst)/100;
    DATA[k] = {...r, liq_rate, s, total, grade: letterGrade(total)};
  });
}

function fmt(n, d=2){ return Number(n).toLocaleString('en-US', {minimumFractionDigits:d, maximumFractionDigits:d}); }
function fmtInt(n){ return Number(n).toLocaleString('en-US'); }
