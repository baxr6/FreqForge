const API = '/api/runs';

/* ============ ESCAPING UTILITIES ============
   Leverage labels are free-text (typed in Add Run, or the rename field) and get
   interpolated into both HTML content AND inline onclick="...('${k}')" attributes
   throughout the UI. Without escaping, a label containing a quote can break out of
   the onclick string and execute arbitrary JS. escapeAttr() is for that context
   specifically; escapeHtml() is for plain text content. */
function escapeHtml(str){
  if(str == null) return '';
  return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function escapeAttr(str){
  // safe for embedding inside a single-quoted string within an inline onclick="...('${x}')"
  if(str == null) return '';
  return String(str).replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
let serverUnreachable = false;
async function loadRuns(){
  try{
    const res = await fetch(API);
    if(res.ok){
      RUNS = await res.json(); // {} is a completely normal, valid state — never auto-populated
      serverUnreachable = false;
      return;
    }
  }catch(e){ console.warn('API unreachable', e); }
  RUNS = {};
  serverUnreachable = true;
}
async function apiSaveRun(lev, metrics){
  try{
    const res = await fetch(`${API}/${encodeURIComponent(lev)}`, {
      method:'PUT',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify(metrics)
    });
    if(!res.ok){
      const body = await res.json().catch(()=>({}));
      alert(`Save failed for ${lev}: ${body.error || res.status+' '+res.statusText}\n\nThis run was NOT actually saved — the display may look updated but it isn't persisted.`);
      return false;
    }
    return true;
  }catch(e){
    console.error('save failed — is the server running?', e);
    alert(`Could not reach the server to save ${lev}. Is app.py running?`);
    return false;
  }
}
async function apiDeleteRun(lev){
  try{
    const res = await fetch(`${API}/${encodeURIComponent(lev)}`, {method:'DELETE'});
    if(!res.ok){ alert(`Delete failed for ${lev}: HTTP ${res.status}`); return false; }
    return true;
  }catch(e){
    console.error('delete failed', e);
    alert(`Could not reach the server to delete ${lev}.`);
    return false;
  }
}

/* ============ ABSOLUTE SCORING v3 — synthesized from published quant-firm thresholds ============
   Sortino and Drawdown bands are adapted from commonly-cited institutional deployability
   guidelines (Sortino >1.5 acceptable/>3.0 strong; Drawdown <20% acceptable/<10% strong).
   Calmar was evaluated and deliberately excluded: at leveraged-crypto scale it's thousands of
   times past any "strong" threshold for every run, adding no differentiation, and it's already
   redundant with scoring CAGR and Drawdown separately. Profit Factor bands were widened beyond
   the published 1.5/2.0 gates for the same reason — your PFs (4-166) blow straight past them.
   Liquidation-safety has no equivalent in generic strategy-evaluation frameworks (leverage-specific).
   Worst-trade severity added as its own category so one catastrophic outlier trade can't hide
   behind an otherwise-strong average — a run's grade never depends on any other run. */
