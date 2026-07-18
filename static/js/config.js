/* ============ SCORING CONFIG ============
   Every threshold here reproduces the exact default curve shapes validated throughout
   this project's build — changing these values reshapes the scoring curves, changing
   the weights below reshapes how much each category counts. Persisted server-side via
   /api/config so it's consistent across every browser/device, not just localStorage. */
const DEFAULT_SCORING_CONFIG = {
  weights: { cagr: 15, sortino: 25, dd: 25, liq: 15, pf: 10, worst: 10 }, // must sum to 100
  cagr_max_threshold: 10000,      // % CAGR that scores 100 points (log scale; 100% always scores 50)
  sortino_acceptable: 1.5,        // Sortino value that scores 50 points
  sortino_strong: 3.0,            // Sortino value that scores 100 points
  drawdown_strong_at: 10,         // % drawdown that scores 90 points
  drawdown_zero_score_at: 40,     // % drawdown that scores 0 points
  liquidation_zero_score_at: 10,  // forced-exit rate % that scores 0 points
  pf_max_threshold: 10.0          // profit factor that scores 100 points
};

let SCORING_CONFIG = JSON.parse(JSON.stringify(DEFAULT_SCORING_CONFIG));

async function fetchScoringConfig(){
  try{
    const res = await fetch('/api/config');
    if(res.ok){
      const cfg = await res.json();
      // merge over defaults so a partially-saved/older config file doesn't leave any field undefined
      SCORING_CONFIG = { ...DEFAULT_SCORING_CONFIG, ...cfg, weights: { ...DEFAULT_SCORING_CONFIG.weights, ...(cfg.weights||{}) } };
    }
  }catch(e){ console.warn('Could not load scoring config, using defaults', e); }
}

async function saveScoringConfig(newConfig){
  try{
    const res = await fetch('/api/config', {
      method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(newConfig)
    });
    if(!res.ok){
      const b = await res.json().catch(()=>({}));
      alert(`Could not save settings: ${b.error || res.status+' '+res.statusText}`);
      return false;
    }
    SCORING_CONFIG = newConfig;
    return true;
  }catch(e){
    alert('Could not reach the server to save settings.');
    return false;
  }
}
