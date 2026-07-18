function exportData(){
  const blob = new Blob([JSON.stringify(RUNS, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `nfix7_leverage_runs_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

document.getElementById('import-file').addEventListener('change', (e)=>{
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = async evt => {
    try{
      const imported = JSON.parse(evt.target.result);
      const iRes = await fetch('/api/import', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify(imported)
      });
      if(!iRes.ok){
        const b = await iRes.json().catch(()=>({}));
        alert(`Import failed: ${b.error || iRes.status+' '+iRes.statusText}\n\nNothing was imported.`);
        return;
      }
      await loadRuns();
      recompute();
  renderHero();
      buildFilterBar(); buildSelector(); refreshCompareUI();
      buildHistory();
      render(ORDER.includes(currentLev) ? currentLev : ORDER[0]);
      alert(`Imported ${Object.keys(imported).length} run(s).`);
    }catch(err){
      alert('That file doesn\'t look like a valid backup JSON.');
    }
  };
  reader.readAsText(file);
});

async function init(){
  await fetchScoringConfig();
  await loadRuns();
  recompute();
  renderHero();
  buildFilterBar(); buildSelector(); refreshCompareUI();
  buildHistory();
  if(ORDER.length === 0){
    document.getElementById('subnav').innerHTML = '';
    document.getElementById('run-banner').innerHTML = '';
    document.getElementById('main').innerHTML = serverUnreachable
      ? '<div class="panel" style="grid-column:1/-1;text-align:center;color:var(--red);">Could not reach the server at /api/runs. Is app.py / the container running?</div>'
      : '<div class="panel" style="grid-column:1/-1;text-align:center;color:var(--text-faint);">No runs yet — add one above with "+ ADD NEW RUN".</div>';
    return;
  }
  render(ORDER.includes("5x") ? "5x" : ORDER[0]);
}
init();
