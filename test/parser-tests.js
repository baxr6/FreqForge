/**
 * Parser regression test harness.
 *
 * Run with: node test/parser-tests.js
 *
 * This exists because of two real bugs this project shipped: a double-escaped regex
 * (`\\\\s` instead of `\\s`) that silently broke Trading Mode detection for weeks
 * before anyone noticed, and the same class of mistake caught earlier during
 * development in a different file. Both were "the regex compiles fine, just never
 * matches anything" — the kind of bug that passes `node --check` and only shows up
 * when a real user's real log doesn't parse the way it should.
 *
 * Every fixture below is either a verbatim excerpt from a real backtest log pasted
 * during this project's development (marked REAL), or a realistic reconstruction
 * following the same pipe-table format freqtrade actually produces (marked
 * SYNTHETIC) where a verified real example wasn't available. Either is enough to
 * catch an escaping/syntax regression — the goal isn't perfect format coverage,
 * it's making sure every parser pattern still actually matches SOMETHING before
 * this ships, rather than finding out from a user's screenshot.
 */

const fs = require('fs');
const path = require('path');

// Load parseFreqtradeLog and parseTradesJSON directly from the source file, without
// duplicating the implementation into this test file (that would defeat the purpose —
// a copy could drift or be "fixed" separately from the real code).
const parsersSrc = fs.readFileSync(path.join(__dirname, '../static/js/parsers.js'), 'utf8');
eval(parsersSrc);

let passed = 0, failed = 0;
const failures = [];

function check(name, actual, expected) {
  const ok = actual === expected;
  if (ok) { passed++; }
  else { failed++; failures.push(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
}

function checkNotNull(name, actual) {
  const ok = actual !== null && actual !== undefined;
  if (ok) { passed++; }
  else { failed++; failures.push(`${name}: expected a non-null match, got ${JSON.stringify(actual)}`); }
}

// ============================================================
// FIXTURE 1 — Standard futures pipe-table log (ASCII pipes), combining REAL excerpts
// pasted during this project with SYNTHETIC lines for fields not directly captured
// as real text elsewhere.
// ============================================================
const FUTURES_LOG = `
2026-07-19 18:57:23,107 - freqtrade - INFO - freqtrade 2026.6
2026-07-19 18:57:23,352 - numexpr.utils - INFO - NumExpr defaulting to 12 threads.
2026-07-16 21:10:30,114 - freqtrade.resolvers.iresolver - INFO - Using resolved strategy NFIx7BackTest3x from '/freqtrade/NFIx7BackTest.py'...
2026-07-18 13:26:50,201 - NFIx7BackTest - INFO - NFI strategy version: v17.4.413
| Backtesting from                       | 2025-09-12 00:00:00                       |
| Backtesting to                         | 2026-07-12 00:00:00                       |
| Max open trades                        | 10                                        |
| Starting balance                       | 500.000 USDT                              |
| CAGR %                                 | 969.87%                                   |
| Sharpe (closed trades)                 | 19.35                                     |
| Sortino (closed trades)                | 18.95                                     |
| Calmar (closed trades)                 | 7363.12                                   |
| Profit factor                          | 163.39                                    |
| SQN                                    | 4.63                                      |
| Total/Daily Avg Trades                 | 333    / 1.09                             |
| Final balance                          | 3576.20 USDT                              |
| Absolute Drawdown (Account)            | 0.53%                                     |
| Worst trade                            | XRP/USDT:USDT -8.59%                      |
| Days win/draw/lose                     | 78     /   30 /    1                      |
`;

const futuresResult = parseFreqtradeLog(FUTURES_LOG);
checkNotNull('futures: cagr', futuresResult.cagr);
check('futures: cagr value', futuresResult.cagr, 969.87);
checkNotNull('futures: sharpe', futuresResult.sharpe);
checkNotNull('futures: sortino', futuresResult.sortino);
checkNotNull('futures: calmar', futuresResult.calmar);
checkNotNull('futures: pf', futuresResult.pf);
check('futures: pf value', futuresResult.pf, 163.39);
checkNotNull('futures: sqn', futuresResult.sqn);
checkNotNull('futures: maxdd', futuresResult.maxdd);
check('futures: maxdd value', futuresResult.maxdd, 0.53);
checkNotNull('futures: trades', futuresResult.trades);
check('futures: trades value', futuresResult.trades, 333);
checkNotNull('futures: final_bal', futuresResult.final_bal);
checkNotNull('futures: worst_trade', futuresResult.worst_trade);
check('futures: worst_trade value', futuresResult.worst_trade, -8.59);
checkNotNull('futures: period_start', futuresResult.period_start);
checkNotNull('futures: period_end', futuresResult.period_end);
checkNotNull('futures: deposit', futuresResult.deposit);
checkNotNull('futures: nfi_version', futuresResult.nfi_version);
check('futures: nfi_version value', futuresResult.nfi_version, 'v17.4.413');
checkNotNull('futures: detected_leverage', futuresResult.detected_leverage);
check('futures: detected_leverage value', futuresResult.detected_leverage, '3x');
checkNotNull('futures: win_days', futuresResult.win_days);
checkNotNull('futures: lose_days', futuresResult.lose_days);
checkNotNull('futures: run_date_label', futuresResult.run_date_label);
check('futures: run_date_label value', futuresResult.run_date_label, '19-07-2026');

// ============================================================
// FIXTURE 2 — Spot log using REAL Unicode-pipe Trading Mode line pasted during this
// project (this exact line is what the double-escaped regex bug silently failed on).
// ============================================================
const SPOT_LOG = `
2026-07-19 22:54:21,581 - freqtrade - INFO - freqtrade 2026.6
2026-07-19 22:54:22,000 - freqtrade.resolvers.iresolver - INFO - Using resolved strategy NostalgiaForInfinityX7 from '/freqtrade/NostalgiaForInfinityX7.py'...
│ Trading Mode                           │ Spot                                      │
| CAGR %                                 | 37.37%                                    |
| Profit factor                          | 26.12                                     |
`;

const spotResult = parseFreqtradeLog(SPOT_LOG);
checkNotNull('spot: market_type', spotResult.market_type);
check('spot: market_type value', spotResult.market_type, 'spot');
check('spot: detected_leverage falls back to SPOT token', spotResult.detected_leverage, 'SPOT');
checkNotNull('spot: cagr', spotResult.cagr);

// ============================================================
// FIXTURE 3 — Alternate drawdown line format (newer freqtrade versions drop the
// "(Account)" suffix) — this is the fallback-regex path, tested separately since
// FIXTURE 1 only exercises the primary pattern.
// ============================================================
const ALT_DRAWDOWN_LOG = `
| Absolute drawdown                      | (0.44%)                                   |
`;
const altDDResult = parseFreqtradeLog(ALT_DRAWDOWN_LOG);
checkNotNull('alt drawdown format: maxdd', altDDResult.maxdd);

// ============================================================
// Report
// ============================================================
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  console.log('FAILURES:');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
} else {
  console.log('All parser regexes matched their expected fixtures.');
  process.exit(0);
}
