// Bulk import: accepts many files at once (console logs + trades.json, mixed), pairs
// each log with its closest-matching trades.json by timestamp, and presents one
// compact review table instead of the single-run flow repeated N times.

let bulkDetectedRuns = []; // [{label, parsed, pairedTradesResult, include}]

function extractLogTimestamp(text){
  const m = text.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/m);
  if(!m) return null;
  return new Date(m[1], m[2]-1, m[3], m[4], m[5], m[6]);
}

function extractJsonFilenameTimestamp(filename){
  const m = filename.match(/backtest-result-(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})/);
  if(!m) return null;
  return new Date(m[1], m[2]-1, m[3], m[4], m[5], m[6]);
}

function readFileAsText(file){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

// Wire up drop zone + file input once at load time.
document.addEventListener('DOMContentLoaded', () => {
  const zone = document.getElementById('bulk-drop-zone');
  if(!zone) return;
  ['dragenter','dragover'].forEach(evt => zone.addEventListener(evt, e => {
    e.preventDefault(); e.stopPropagation(); zone.classList.add('drag-over');
  }));
  ['dragleave','drop'].forEach(evt => zone.addEventListener(evt, e => {
    e.preventDefault(); e.stopPropagation(); zone.classList.remove('drag-over');
  }));
  zone.addEventListener('drop', e => {
    const files = Array.from(e.dataTransfer.files);
    if(files.length) handleBulkFiles(files);
  });
  document.getElementById('bulk-file-input').addEventListener('change', e => {
    const files = Array.from(e.target.files);
    if(files.length) handleBulkFiles(files);
  });
});

async function handleBulkFiles(files){
  const statusEl = document.getElementById('bulk-status');
  statusEl.innerHTML = `<div class="parse-status">Reading ${files.length} file${files.length!==1?'s':''}...</div>`;

  const logFiles = files.filter(f => /\.(log|txt)$/i.test(f.name));
  const jsonFiles = files.filter(f => /\.json$/i.test(f.name));

  if(logFiles.length === 0){
    statusEl.innerHTML = `<div class="parse-status warn">No .log/.txt files found among the ${files.length} file(s) dropped — need at least one console log to detect a run.</div>`;
    return;
  }

  // Parse every log
  const parsedLogs = [];
  for(const file of logFiles){
    const text = await readFileAsText(file);
    const parsed = parseFreqtradeLog(text);
    const timestamp = extractLogTimestamp(text) || new Date(file.lastModified);
    parsedLogs.push({ file, text, parsed, timestamp });
  }

  // Read + timestamp every trades.json candidate, and validate it's actually a trades export
  const candidateTradesFiles = [];
  for(const file of jsonFiles){
    const text = await readFileAsText(file);
    const result = parseTradesJSON(text);
    // Prefer the filename timestamp (freqtrade's default naming) — but a renamed file
    // (e.g. "trades.json") won't match that pattern, so fall back to the file's own
    // last-modified time, which reflects when it was actually written regardless of
    // what it's called.
    const timestamp = extractJsonFilenameTimestamp(file.name) || new Date(file.lastModified);
    candidateTradesFiles.push({ file, text, result, timestamp, valid: !result.error, used: false });
  }

  // Pair each log to its closest-timestamp trades.json within a 60-minute window —
  // greedy nearest-match, each trades file can only be claimed once.
  const PAIR_WINDOW_MS = 60 * 60 * 1000;
  for(const log of parsedLogs){
    if(!log.timestamp) continue;
    let best = null, bestDiff = Infinity;
    for(const tf of candidateTradesFiles){
      if(tf.used || !tf.valid || !tf.timestamp) continue;
      const diff = Math.abs(tf.timestamp - log.timestamp);
      if(diff < bestDiff && diff <= PAIR_WINDOW_MS){ best = tf; bestDiff = diff; }
    }
    if(best){ best.used = true; log.pairedTrades = best; }
  }

  // Build the detected-runs list with auto-generated labels (same convention as
  // single-add: leverage/SPOT + run date, deduplicated against existing saved runs)
  bulkDetectedRuns = parsedLogs.map(log => {
    const runDate = log.parsed.run_date_label || todayDateLabel();
    const leverageToken = log.parsed.detected_leverage || 'UNKNOWN';
    const label = uniqueAutoLabel(`NFIx7-${leverageToken}-${runDate}`);
    return { label, ...log, include: true };
  });

  const unpairedTrades = candidateTradesFiles.filter(tf => !tf.used);
  statusEl.innerHTML = `<div class="parse-status ok">
    Detected ${bulkDetectedRuns.length} run${bulkDetectedRuns.length!==1?'s':''} from ${logFiles.length} log file(s).
    ${bulkDetectedRuns.filter(r=>r.pairedTrades).length} paired with a trades.json.
    ${unpairedTrades.length ? ` ${unpairedTrades.length} trades.json file(s) had no matching log within the pairing window and will be ignored.` : ''}
  </div>`;

  renderBulkReview();
}

function renderBulkReview(){
  const panel = document.getElementById('bulk-review-panel');
  if(bulkDetectedRuns.length === 0){ panel.innerHTML = ''; return; }

  panel.innerHTML = `
    <div style="margin-top:16px;">
      ${bulkDetectedRuns.map((run, i) => `
        <div class="bulk-review-row">
          <input type="checkbox" ${run.include ? 'checked' : ''} onchange="bulkDetectedRuns[${i}].include = this.checked">
          <input type="text" value="${escapeAttr(run.label)}" onchange="bulkDetectedRuns[${i}].label = this.value">
          <span style="font-family:var(--mono);font-size:12px;color:var(--text-dim);min-width:90px;">
            ${run.parsed.cagr!=null ? fmt(run.parsed.cagr,1)+'% CAGR' : 'no CAGR found'}
          </span>
          <span style="font-family:var(--mono);font-size:11px;color:var(--text-faint);min-width:110px;">
            ${escapeHtml(run.file.name)}
          </span>
          <span class="${run.pairedTrades ? 'paired-yes' : 'paired-no'}" style="font-family:var(--mono);font-size:11px;margin-left:auto;">
            ${run.pairedTrades ? `&#10003; paired with ${escapeHtml(run.pairedTrades.file.name)}` : 'no trades.json paired'}
          </span>
        </div>`).join('')}
      <button class="btn" onclick="saveBulkRuns()">Save ${bulkDetectedRuns.length} checked run(s)</button>
      <button class="btn secondary" onclick="bulkDetectedRuns=[]; renderBulkReview(); document.getElementById('bulk-status').innerHTML='';">Clear</button>
      <div id="bulk-save-status"></div>
    </div>`;
}

async function saveBulkRuns(){
  const statusEl = document.getElementById('bulk-save-status');
  const toSave = bulkDetectedRuns.filter(r => r.include);
  if(toSave.length === 0){ statusEl.innerHTML = '<div class="parse-status warn">Nothing checked to save.</div>'; return; }

  statusEl.innerHTML = `<div class="parse-status">Saving 0 / ${toSave.length}...</div>`;
  let saved = 0, failed = 0;

  for(const run of toSave){
    try{
      const runBody = { ...run.parsed };
      delete runBody.detected_leverage; // UI-only helper field, not a saved column
      delete runBody.run_date_label;    // also UI-only, used for the label, not a DB column
      // Text fields (market_type, exchange, etc.) can stay null/empty — the backend
      // handles those. Numeric fields need coercing to 0 here, same as the single-run
      // save flow already does — sending an explicit `null` for e.g. calmar overrides
      // the backend's own "default to 0 if the key is missing entirely" fallback, and
      // later renders as `null.toFixed()` crashing the history table.
      const TEXT_FIELD_NAMES = new Set(['period_start','period_end','exchange','market_type']);
      for(const k of Object.keys(runBody)){
        if(!TEXT_FIELD_NAMES.has(k) && (runBody[k] === null || Number.isNaN(runBody[k]))){
          runBody[k] = 0;
        }
      }
      const ok = await apiSaveRun(run.label, runBody);
      if(!ok){ failed++; continue; }

      if(run.pairedTrades && run.pairedTrades.result && !run.pairedTrades.result.error){
        const tr = run.pairedTrades.result;
        await fetch(`${API}/${encodeURIComponent(run.label)}/detail/trades`, {
          method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(tr.trades)
        });
        const extras = {};
        if(tr.pairlist_count != null) extras.pairlist_count = tr.pairlist_count;
        if(tr.pairlist_hash != null) extras.pairlist_hash = tr.pairlist_hash;
        if(tr.p_value != null) extras.p_value = tr.p_value;
        if(tr.expectancy != null) extras.expectancy = tr.expectancy;
        if(tr.expectancy_ratio != null) extras.expectancy_ratio = tr.expectancy_ratio;
        if(tr.max_consecutive_wins != null) extras.max_consecutive_wins = tr.max_consecutive_wins;
        if(tr.max_consecutive_losses != null) extras.max_consecutive_losses = tr.max_consecutive_losses;
        if(tr.winner_holding_avg != null) extras.winner_holding_avg = tr.winner_holding_avg;
        if(tr.loser_holding_avg != null) extras.loser_holding_avg = tr.loser_holding_avg;
        if(!run.parsed.market_type && tr.market_type_from_pairs) extras.market_type = tr.market_type_from_pairs;
        if(Object.keys(extras).length) await apiSaveRun(run.label, { ...runBody, ...extras });
      }
      saved++;
    }catch(e){
      failed++;
    }
    statusEl.innerHTML = `<div class="parse-status">Saving ${saved+failed} / ${toSave.length}...</div>`;
  }

  statusEl.innerHTML = `<div class="parse-status ${failed?'warn':'ok'}">Saved ${saved} run(s)${failed?`, ${failed} failed`:''}. <button class="btn secondary" style="margin-left:8px;" onclick="bulkDetectedRuns=[]; renderBulkReview(); document.getElementById('bulk-status').innerHTML='';">Clear and import more</button></div>`;

  await loadRuns();
  recompute();
  renderHero();
  buildFilterBar(); buildSelector();
  buildHistory();
  if(ORDER.length) render(ORDER.includes(currentLev) ? currentLev : ORDER[0]);
}
