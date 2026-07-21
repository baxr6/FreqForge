// Visualizes a single trade's actual entries/exits on a real price chart, fetched
// from Binance via the backend proxy (see /api/candles in app.py — CORS-avoidance
// reasoning documented there).

let priceChartTradesCache = [];

function bindPriceChartTrades(trades){
  priceChartTradesCache = trades;
}

function intervalForDuration(minutes){
  // Pick a candle size that keeps the chart readable regardless of trade length —
  // a 3-day grind trade on 1m candles would be an unreadable wall of bars, and a
  // 20-minute scalp on 4h candles would show as a single blob.
  if(minutes <= 60) return '1m';
  if(minutes <= 240) return '5m';
  if(minutes <= 1440) return '15m';
  if(minutes <= 4320) return '1h';
  return '4h';
}

async function showPriceChart(index){
  const t = priceChartTradesCache[index];
  if(!t) return;

  const overlay = document.createElement('div');
  overlay.className = 'trade-modal-overlay';
  overlay.onclick = (e) => { if(e.target === overlay) closePriceChartModal(); };
  overlay.innerHTML = `
    <div class="trade-modal">
      <div class="trade-modal-header">
        <div><b>${escapeHtml(t.pair)}</b> &mdash; ${escapeHtml(t.open_date)} &rarr; ${escapeHtml(t.close_date)}</div>
        <button class="close-btn" onclick="closePriceChartModal()">&times;</button>
      </div>
      <div id="price-chart-body" style="padding:20px;min-height:340px;display:flex;align-items:center;justify-content:center;color:var(--text-faint);font-family:var(--mono);font-size:13px;">
        Loading candles from Binance...
      </div>
    </div>`;
  document.body.appendChild(overlay);
  document.addEventListener('keydown', closeTradeModalOnEsc);

  try{
    let orders = [];
    try{ orders = JSON.parse(t.orders_json || '[]'); }catch(e){ orders = []; }

    const openMs = new Date(t.open_date).getTime();
    const closeMs = new Date(t.close_date).getTime();
    const durationMin = Math.max(1, (closeMs - openMs) / 60000);
    const interval = intervalForDuration(durationMin);
    const padding = Math.max((closeMs - openMs) * 0.3, 15 * 60000); // context before/after the trade itself
    const startTs = Math.round(openMs - padding);
    const endTs = Math.round(closeMs + padding);

    let candles = null, dataSource = null, lastError = null;

    // Try a direct browser-to-Binance fetch first — one less network hop, and known to
    // work today (verified against this exact setup). Falls back to the backend proxy
    // if it fails for any reason: CORS starts blocking it (reported inconsistent over
    // time on Binance's side), a firewall/VPN interferes, or anything else — same
    // candles either way, just a different path to get them.
    try{
      const isFutures = t.pair.includes(':');
      const symbol = t.pair.split(':')[0].replace('/', '');
      const directUrl = isFutures
        ? `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&startTime=${startTs}&endTime=${endTs}&limit=500`
        : `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&startTime=${startTs}&endTime=${endTs}&limit=500`;
      const directRes = await fetch(directUrl);
      if(directRes.ok){
        const rawCandles = await directRes.json();
        candles = rawCandles.map(row => ({ time: row[0], open: parseFloat(row[1]), high: parseFloat(row[2]), low: parseFloat(row[3]), close: parseFloat(row[4]), volume: parseFloat(row[5]) }));
        dataSource = 'direct';
      }
    }catch(e){
      lastError = e; // CORS block surfaces here as a generic TypeError — expected, not logged as an error
    }

    if(!candles){
      const res = await fetch(`/api/candles?pair=${encodeURIComponent(t.pair)}&interval=${interval}&start_ts=${startTs}&end_ts=${endTs}`);
      const data = await res.json();
      if(!res.ok || data.error){
        document.getElementById('price-chart-body').innerHTML = `<div style="text-align:center;">
          <div style="color:var(--red);">Could not load chart: ${escapeHtml(data.error || 'unknown error')}</div>
          ${data.detail ? `<div style="color:var(--text-faint);font-size:11px;margin-top:6px;">${escapeHtml(data.detail)}</div>` : ''}
        </div>`;
        return;
      }
      candles = data.candles;
      dataSource = 'proxy';
    }

    if(!candles || candles.length === 0){
      document.getElementById('price-chart-body').innerHTML = '<div>No candle data returned for this pair/window.</div>';
      return;
    }

    renderCandlestickChart(candles, orders, t, interval, dataSource);
  }catch(e){
    document.getElementById('price-chart-body').innerHTML = `<div style="color:var(--red);">Failed to load chart: ${escapeHtml(e.message)}</div>`;
  }
}

function closePriceChartModal(){
  const overlay = document.querySelector('.trade-modal-overlay');
  if(overlay) overlay.remove();
  document.removeEventListener('keydown', closeTradeModalOnEsc);
}

function renderCandlestickChart(candles, orders, trade, interval, dataSource){
  const W = 900, H = 380, PAD_L = 55, PAD_R = 20, PAD_T = 20, PAD_B = 30;
  const prices = candles.flatMap(c => [c.high, c.low]);
  const minP = Math.min(...prices), maxP = Math.max(...prices);
  const priceSpan = (maxP - minP) || 1;
  const candleW = (W - PAD_L - PAD_R) / candles.length;

  const xFor = i => PAD_L + i*candleW + candleW/2;
  const yFor = price => PAD_T + (1 - (price-minP)/priceSpan) * (H - PAD_T - PAD_B);

  const candleBars = candles.map((c,i) => {
    const isUp = c.close >= c.open;
    const color = isUp ? 'var(--green)' : 'var(--red)';
    const bodyTop = yFor(Math.max(c.open,c.close));
    const bodyBot = yFor(Math.min(c.open,c.close));
    const bodyH = Math.max(1, bodyBot-bodyTop);
    return `
      <line x1="${xFor(i)}" y1="${yFor(c.high)}" x2="${xFor(i)}" y2="${yFor(c.low)}" stroke="${color}" stroke-width="1"/>
      <rect x="${xFor(i)-candleW*0.35}" y="${bodyTop}" width="${candleW*0.7}" height="${bodyH}" fill="${color}"/>`;
  }).join('');

  // Overlay real entry/exit points from this trade's own orders — blue for entries,
  // purple for exits, matching the same open/close color semantics used in the Grind
  // Analysis order modal (ft_is_entry, not raw buy/sell — correct for shorts too).
  const orderMarkers = orders.map(o => {
    const orderMs = new Date(o.ts).getTime();
    let closestIdx = 0, closestDiff = Infinity;
    candles.forEach((c,i) => { const diff = Math.abs(c.time - orderMs); if(diff < closestDiff){ closestDiff = diff; closestIdx = i; } });
    const isEntry = o.entry !== false && o.entry !== undefined ? o.entry : (o.side && o.side.toLowerCase() === 'buy');
    const color = isEntry ? 'var(--brand-b)' : '#a855f7';
    const y = yFor(o.price);
    const x = xFor(closestIdx);
    return `
      <line x1="${x}" y1="${y-14}" x2="${x}" y2="${y+14}" stroke="${color}" stroke-width="2" stroke-dasharray="2,2" opacity="0.6"/>
      <circle cx="${x}" cy="${y}" r="5" fill="${color}" stroke="var(--void)" stroke-width="1.5"/>
      <text x="${x}" y="${y-18}" fill="${color}" font-size="10" font-family="var(--mono)" text-anchor="middle">${isEntry?'ENTRY':'EXIT'}</text>`;
  }).join('');

  const yLabels = [minP, minP+priceSpan*0.5, maxP].map(p => `<text x="6" y="${yFor(p)+4}" fill="var(--text-faint)" font-size="10" font-family="var(--mono)">${fmt(p, p<1?5:2)}</text>`).join('');

  document.getElementById('price-chart-body').innerHTML = `
    <div style="width:100%;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
        <span style="font-family:var(--mono);font-size:11px;color:var(--text-faint);">${escapeHtml(trade.pair)} &middot; ${interval} candles ${dataSource ? `&middot; <span style="color:${dataSource==='direct'?'var(--green)':'var(--text-faint)'};">${dataSource==='direct'?'fetched directly':'via FreqForge backend'}</span>` : ''}</span>
        <span style="font-family:var(--mono);font-size:11px;color:var(--text-faint);"><span style="color:var(--brand-b);">&#9679;</span> entry &nbsp; <span style="color:#a855f7;">&#9679;</span> exit</span>
      </div>
      <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;">
        ${yLabels}
        ${candleBars}
        ${orderMarkers}
      </svg>
    </div>`;
}
