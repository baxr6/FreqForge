function openSettingsModal(){
  const cfg = SCORING_CONFIG;
  const overlay = document.createElement('div');
  overlay.className = 'trade-modal-overlay';
  overlay.onclick = (e) => { if(e.target === overlay) closeSettingsModal(); };

  const weightField = (key, label) => `
    <div class="review-field">
      <label>${label}</label>
      <input type="number" id="cfg-w-${key}" value="${cfg.weights[key]}" min="0" max="100" step="1" oninput="updateWeightTotal()">
    </div>`;

  const thresholdField = (key, label, step='0.1') => `
    <div class="review-field">
      <label>${label}</label>
      <input type="number" id="cfg-${key}" value="${cfg[key]}" step="${step}">
    </div>`;

  overlay.innerHTML = `
    <div class="trade-modal" style="max-width:640px;">
      <div class="trade-modal-header">
        <h3>&#9881; Scoring Settings</h3>
        <button class="close-btn" onclick="closeSettingsModal()">&times;</button>
      </div>
      <div class="trade-modal-body">
        <div class="panel-label" style="margin-bottom:4px;">Category Weights <span id="weight-total" style="font-weight:normal;"></span></div>
        <div class="review-grid">
          ${weightField('sortino','Sortino')}
          ${weightField('dd','Drawdown')}
          ${weightField('cagr','CAGR')}
          ${weightField('liq','Liquidation-safety')}
          ${weightField('pf','Profit Factor')}
          ${weightField('worst','Worst-trade severity')}
        </div>
        <div class="storage-note" style="margin-top:6px;">Must sum to 100 — the total updates live as you type.</div>

        <div class="panel-label" style="margin:22px 0 4px;">Curve Thresholds</div>
        <div class="review-grid">
          ${thresholdField('cagr_max_threshold','CAGR % for 100pts','100')}
          ${thresholdField('sortino_acceptable','Sortino "acceptable" (50pts)')}
          ${thresholdField('sortino_strong','Sortino "strong" (100pts)')}
          ${thresholdField('drawdown_strong_at','Drawdown "strong" % (90pts)')}
          ${thresholdField('drawdown_zero_score_at','Drawdown 0pts at %')}
          ${thresholdField('liquidation_zero_score_at','Liquidation 0pts at %')}
          ${thresholdField('pf_max_threshold','Profit Factor for 100pts')}
        </div>
        <div class="storage-note">These reshape the scoring curves themselves — e.g. lowering "Drawdown 0pts at %" makes the tool stricter about drawdown. Defaults are grounded in published quant-deployability guidelines, adapted for leveraged-crypto scale (see the Methodology note at the bottom of the page).</div>

        <div style="margin-top:20px;">
          <button class="btn" onclick="saveSettingsFromModal()">Save &amp; Recompute</button>
          <button class="btn secondary" onclick="resetSettingsToDefaults()">Reset to defaults</button>
          <button class="btn secondary" onclick="closeSettingsModal()">Cancel</button>
        </div>
        <div id="settings-status"></div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  document.addEventListener('keydown', closeSettingsModalOnEsc);
  updateWeightTotal();
}

function updateWeightTotal(){
  const keys = ['sortino','dd','cagr','liq','pf','worst'];
  const total = keys.reduce((sum,k)=> sum + (parseFloat(document.getElementById(`cfg-w-${k}`).value) || 0), 0);
  const el = document.getElementById('weight-total');
  el.textContent = `Total: ${total}%`;
  el.style.color = Math.abs(total-100) < 0.5 ? 'var(--green)' : 'var(--red)';
}

function closeSettingsModalOnEsc(e){ if(e.key === 'Escape') closeSettingsModal(); }

function closeSettingsModal(){
  const overlay = document.querySelector('.trade-modal-overlay');
  if(overlay) overlay.remove();
  document.removeEventListener('keydown', closeSettingsModalOnEsc);
}

async function saveSettingsFromModal(){
  const weights = {};
  ['sortino','dd','cagr','liq','pf','worst'].forEach(k=>{
    weights[k] = parseFloat(document.getElementById(`cfg-w-${k}`).value) || 0;
  });
  const newConfig = {
    weights,
    cagr_max_threshold: parseFloat(document.getElementById('cfg-cagr_max_threshold').value),
    sortino_acceptable: parseFloat(document.getElementById('cfg-sortino_acceptable').value),
    sortino_strong: parseFloat(document.getElementById('cfg-sortino_strong').value),
    drawdown_strong_at: parseFloat(document.getElementById('cfg-drawdown_strong_at').value),
    drawdown_zero_score_at: parseFloat(document.getElementById('cfg-drawdown_zero_score_at').value),
    liquidation_zero_score_at: parseFloat(document.getElementById('cfg-liquidation_zero_score_at').value),
    pf_max_threshold: parseFloat(document.getElementById('cfg-pf_max_threshold').value),
  };

  const totalWeight = Object.values(weights).reduce((a,b)=>a+b, 0);
  const statusEl = document.getElementById('settings-status');
  if(Math.abs(totalWeight - 100) > 0.5){
    statusEl.innerHTML = `<div class="parse-status warn">Weights must sum to 100 (currently ${totalWeight}).</div>`;
    return;
  }

  const ok = await saveScoringConfig(newConfig);
  if(!ok) return;

  closeSettingsModal();
  recompute();
  renderHero();
  buildFilterBar(); buildSelector(); refreshCompareUI();
  buildHistory();
  if(currentLev) render(currentLev);
}

function resetSettingsToDefaults(){
  SCORING_CONFIG = JSON.parse(JSON.stringify(DEFAULT_SCORING_CONFIG));
  closeSettingsModal();
  openSettingsModal();
}
