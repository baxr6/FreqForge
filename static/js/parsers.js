function parseFreqtradeLog(text){
  const out = {};
  // freqtrade's rich-rendered tables use U+2502 (│) as the column separator, not ASCII '|'.
  // Accept either, plus surrounding whitespace, so this works against both plain and rich output.
  const SEP = '[|\u2502]';
  const grab = (re) => { const m = text.match(re); return m ? parseFloat(m[1].replace(/,/g,'')) : null; };

  out.cagr = grab(new RegExp('CAGR\\s*%?\\s*'+SEP+'\\s*([\\-0-9.,]+)', 'i'));
  // Two Sharpe/Calmar variants exist in freqtrade's output — "(closed trades)" and
  // "(daily wallet balance)". We want closed-trades specifically.
  out.sharpe = grab(new RegExp('Sharpe \\(closed trades\\)\\s*'+SEP+'\\s*([\\-0-9.,]+)', 'i'));
  out.sortino = grab(new RegExp('Sortino \\(closed trades\\)\\s*'+SEP+'\\s*([\\-0-9.,]+)', 'i'));
  out.calmar = grab(new RegExp('Calmar \\(closed trades\\)\\s*'+SEP+'\\s*([\\-0-9.,]+)', 'i'));
  out.pf = grab(new RegExp('Profit factor\\s*'+SEP+'\\s*([\\-0-9.,]+)', 'i'));
  out.sqn = grab(new RegExp('\\bSQN\\s*'+SEP+'\\s*([\\-0-9.,]+)', 'i'));
  out.maxdd = grab(new RegExp('Absolute Drawdown \\(Account\\)\\s*'+SEP+'\\s*([\\-0-9.,]+)', 'i'))
           ?? grab(new RegExp('Absolute drawdown\\s*'+SEP+'[^(]*\\(([\\-0-9.]+)%\\)', 'i'))
           ?? grab(new RegExp('Max % of account underwater\\s*'+SEP+'\\s*([\\-0-9.,]+)', 'i'))
           ?? grab(new RegExp('Max Drawdown\\s*'+SEP+'\\s*([\\-0-9.,]+)', 'i'));
  out.trades = grab(new RegExp('Total\\/Daily Avg Trades\\s*'+SEP+'\\s*(\\d+)', 'i'))
            ?? grab(new RegExp('Total trades\\s*'+SEP+'\\s*(\\d+)', 'i'));
  out.final_bal = grab(new RegExp('Final balance\\s*'+SEP+'\\s*([\\-0-9.,]+)', 'i'));
  // "Worst trade" row format: "PAIR -6.37%" — no parentheses, just a trailing % number.
  out.worst_trade = grab(new RegExp('Worst trade\\s*'+SEP+'[^\\n]*?([\\-0-9.]+)\\s*%', 'i'));

  const fromMatch = text.match(new RegExp('Backtesting from\\s*'+SEP+'\\s*(\\d{4}-\\d{2}-\\d{2})', 'i'));
  const toMatch = text.match(new RegExp('Backtesting to\\s*'+SEP+'\\s*(\\d{4}-\\d{2}-\\d{2})', 'i'));
  if(fromMatch && toMatch){
    out.period_start = fromMatch[1];
    out.period_end = toMatch[1];
  } else {
    const periodMatch = text.match(/Backtesting with data from\s+([\d-]+)\s+[\d:]+\s+up to\s+([\d-]+)\s+[\d:]+/i);
    out.period_start = periodMatch ? periodMatch[1] : null;
    out.period_end = periodMatch ? periodMatch[2] : null;
  }
  const maxTradesMatch = text.match(/Using max_open_trades:\s*(\d+)/i);
  out.max_trades = maxTradesMatch ? parseInt(maxTradesMatch[1]) : null;
  out.deposit = grab(new RegExp('Starting balance\\s*'+SEP+'\\s*([\\-0-9.,]+)\\s*USDT', 'i'));

  const exchangeMatch = text.match(/Using exchange\s+(\w+)/i) || text.match(/Using Exchange\s+"(\w+)"/i);
  out.exchange = exchangeMatch ? exchangeMatch[1][0].toUpperCase() + exchangeMatch[1].slice(1).toLowerCase() : null;

  // Market type: freqtrade's backtest summary includes a "Trading Mode" row. Exact spacing/
  // capitalization isn't verified against a real log sample, so this is deliberately flexible —
  // if it doesn't match, parseTradesJSON's pair-naming fallback (BTC/USDT vs BTC/USDT:USDT)
  // usually catches it instead, and Quick Edit covers whatever's left.
  const tradingModeMatch = text.match(new RegExp('Trading\\s*[Mm]ode\\s*'+SEP+'\\s*(Spot|Futures)', 'i'));
  out.market_type = tradingModeMatch ? tradingModeMatch[1].toLowerCase() : null;

  const versionMatch = text.match(/NFI strategy version:\s*(\S+)/i);
  out.nfi_version = versionMatch ? versionMatch[1] : null;

  const strategyMatch = text.match(/Using resolved strategy \w*?(\d+x)\b/i);
  out.detected_leverage = strategyMatch ? strategyMatch[1].toLowerCase() : null;

  const daysMatch = text.match(new RegExp('Days win\\/draw\\/lose\\s*'+SEP+'\\s*(\\d+)\\s*\\/\\s*(\\d+)\\s*\\/\\s*(\\d+)', 'i'));
  out.win_days = daysMatch ? parseInt(daysMatch[1]) : null;
  out.lose_days = daysMatch ? parseInt(daysMatch[3]) : null;

  // exit reason table: sum counts for liquidation / stop_loss rows.
  // Only flag as "missing" (null) if the EXIT REASON STATS section itself isn't found —
  // a found table with zero liquidation/stop_loss rows genuinely means 0, not unknown.
  const hasExitTable = /EXIT REASON STATS/i.test(text);
  let liq_count = 0, sl_count = 0;
  const lines = text.split('\n');
  lines.forEach(line=>{
    const cells = line.split(/[|\u2502]/).map(c=>c.trim()).filter(c=>c.length);
    if(cells.length<2) return;
    const label = cells[0].toLowerCase();
    const count = parseInt(cells[1]);
    if(!isNaN(count)){
      if(label==='liquidation') liq_count += count;
      if(label==='stop_loss') sl_count += count;
    }
  });
  out.liq_count = hasExitTable ? liq_count : null;
  out.sl_count = hasExitTable ? sl_count : null;

  return out;
}

/* ============ DETAIL TABLE PARSERS (Pairs / Exit Reasons / Enter Tags / Day Breakdown) ============ */
function parsePairLikeTable(text, headerTitle){
  const startIdx = text.indexOf(headerTitle);
  if(startIdx === -1) return [];
  const section = text.slice(startIdx);
  const endIdx = section.indexOf('\u2514'); // └
  const block = endIdx === -1 ? section : section.slice(0, endIdx);
  const lines = block.split('\n').filter(l => (l.includes('|')||l.includes('\u2502')) && !/\bTOTAL\b/.test(l));
  const rows = [];
  lines.forEach(line=>{
    const cells = line.split(/[|\u2502]/).map(c=>c.trim()).filter(c=>c.length);
    if(cells.length < 7) return;
    const [label, count, avgPct, totUsdt, totPct, duration, wdlw] = cells;
    const nums = wdlw.split(/\s+/).map(Number);
    if(nums.length !== 4 || isNaN(parseInt(count))) return;
    rows.push({label, count: parseInt(count), avg_profit_pct: parseFloat(avgPct)||0, tot_profit_usdt: parseFloat(totUsdt)||0,
      tot_profit_pct: parseFloat(totPct)||0, duration, win: nums[0], draw: nums[1], loss: nums[2], win_pct: nums[3]});
  });
  return rows;
}

function parseDayBreakdown(text){
  const startIdx = text.indexOf('DAY BREAKDOWN');
  if(startIdx === -1) return [];
  const section = text.slice(startIdx);
  const endIdx = section.indexOf('\u2514');
  const block = endIdx === -1 ? section : section.slice(0, endIdx);
  const lines = block.split('\n').filter(l => l.includes('|')||l.includes('\u2502'));
  const rows = [];
  lines.forEach(line=>{
    const cells = line.split(/[|\u2502]/).map(c=>c.trim()).filter(c=>c.length);
    if(cells.length < 5) return;
    const [day, trades, totUsdt, pf, wdlw] = cells;
    const nums = wdlw.split(/\s+/).map(Number);
    if(nums.length !== 4 || isNaN(parseInt(trades))) return;
    rows.push({day, trades: parseInt(trades), tot_profit_usdt: parseFloat(totUsdt)||0, profit_factor: parseFloat(pf)||0,
      win: nums[0], draw: nums[1], loss: nums[2], win_pct: nums[3]});
  });
  return rows;
}

function parseAllDetailTables(text){
  return {
    pairs: parsePairLikeTable(text, 'BACKTESTING REPORT'),
    exits: parsePairLikeTable(text, 'EXIT REASON STATS'),
    enters: parsePairLikeTable(text, 'ENTER TAG STATS'),
    days: parseDayBreakdown(text)
  };
}

/* ============ TRADES JSON PARSER (from freqtrade's --export trades output) ============
   NOTE: this targets freqtrade's standard trade-list schema. Not yet verified against a
   real export file — if it comes back empty or wrong, paste a sample and it'll get fixed
   the same way the log parser did. */
function parseTradesJSON(raw){
  let data;
  try{ data = JSON.parse(raw); } catch(e){ return { error: 'Not valid JSON.' }; }

  // freqtrade backtest result JSON can be shaped a few ways depending on export mode —
  // try the common ones.
  let tradeList = null;
  let stratData = null;
  if(Array.isArray(data)) tradeList = data;
  else if(data.trades && Array.isArray(data.trades)) tradeList = data.trades;
  else if(data.strategy){
    const stratKey = Object.keys(data.strategy)[0];
    if(stratKey && data.strategy[stratKey].trades){
      stratData = data.strategy[stratKey];
      tradeList = stratData.trades;
    }
  }
  if(!tradeList) return { error: 'Could not find a trade list in this JSON — schema may differ from what was expected.' };

  const trades = tradeList.map(t => ({
    pair: t.pair ?? '',
    profit_pct: (t.profit_ratio!=null ? t.profit_ratio*100 : t.profit_pct) ?? 0,
    profit_abs: t.profit_abs ?? 0,
    open_date: t.open_date ?? '',
    close_date: t.close_date ?? '',
    exit_reason: (t.exit_reason ?? '').trim(),
    enter_tag: (t.enter_tag ?? '').trim(),
    duration_min: t.trade_duration ?? 0,
    order_count: Array.isArray(t.orders) ? t.orders.length : 0,
    is_short: !!t.is_short,
    orders_json: Array.isArray(t.orders) ? JSON.stringify(t.orders.map(o => ({
      side: o.ft_order_side ?? '',
      entry: !!o.ft_is_entry,
      tag: (o.ft_order_tag ?? '').trim(),
      cost: o.cost ?? 0,
      price: o.safe_price ?? 0,
      amount: o.amount ?? 0,
      ts: o.order_filled_timestamp ?? null
    }))) : '[]'
  }));

  // Pairlist fingerprint: simple, fast, order-independent hash so two runs using a
  // differently-ordered-but-identical list still match, but any real difference (added/
  // removed/swapped pair) changes the hash. Not cryptographic — just needs to detect drift.
  let pairlist_count = null, pairlist_hash = null;
  if(stratData && Array.isArray(stratData.pairlist)){
    const sorted = [...stratData.pairlist].sort();
    pairlist_count = sorted.length;
    let h = 0;
    const joined = sorted.join(',');
    for(let i=0; i<joined.length; i++){ h = ((h<<5)-h+joined.charCodeAt(i))|0; }
    pairlist_hash = (h>>>0).toString(16);
  }

  // p_value: freqtrade's own one-sample t-test on mean per-trade return vs zero.
  // "is the average profit distinguishable from noise?" — informational only, deliberately
  // not folded into the scoring formula since freqtrade's own docs caveat it heavily
  // (assumes independent trades, which real strategies rarely are; not proof of genuine edge).
  const p_value = (stratData && typeof stratData.p_value === 'number') ? stratData.p_value : null;

  // Market type fallback: freqtrade's own pair-naming convention differs by market —
  // spot pairs are "BASE/QUOTE" (e.g. BTC/USDT), futures pairs are "BASE/QUOTE:SETTLE"
  // (e.g. BTC/USDT:USDT). More reliable than the log-line parse since this format is
  // directly confirmed, not guessed at.
  const market_type_from_pairs = trades.length ? (trades[0].pair.includes(':') ? 'futures' : 'spot') : null;
  const expectancy = (stratData && typeof stratData.expectancy === 'number') ? stratData.expectancy : null;
  const expectancy_ratio = (stratData && typeof stratData.expectancy_ratio === 'number') ? stratData.expectancy_ratio : null;
  const max_consecutive_wins = (stratData && typeof stratData.max_consecutive_wins === 'number') ? stratData.max_consecutive_wins : null;
  const max_consecutive_losses = (stratData && typeof stratData.max_consecutive_losses === 'number') ? stratData.max_consecutive_losses : null;
  const winner_holding_avg = (stratData && typeof stratData.winner_holding_avg === 'string') ? stratData.winner_holding_avg : null;
  const loser_holding_avg = (stratData && typeof stratData.loser_holding_avg === 'string') ? stratData.loser_holding_avg : null;

  return { trades, pairlist_count, pairlist_hash, p_value, expectancy, expectancy_ratio,
           max_consecutive_wins, max_consecutive_losses, winner_holding_avg, loser_holding_avg,
           market_type_from_pairs };
}

