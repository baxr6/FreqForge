![FreqForge](docs/images/banner/banner.png)

# FreqForge

Self-hosted leverage backtest scorecard for NFIx7. Real SQLite storage, served over
HTTP, accessible from any device on your network while the server's running. Every
score is computed **independently per run against fixed thresholds** — adding,
removing, or editing one run never changes another's grade. Weights and thresholds
are fully configurable in-app, not hardcoded.

![Main view](docs/images/screenshots/main.png)

## Project structure

```
freqforge/
├── app.py                    Flask backend, SQLite storage, scoring config API
├── static/
│   ├── index.html            HTML skeleton only — no embedded CSS/JS
│   ├── css/app.css           All styling
│   ├── img/banner.png        In-app header banner (swap freely, keep the filename)
│   └── js/
│       ├── constants.js      Grade colors, letter-grade bands, core state (RUNS/DATA/ORDER)
│       ├── api.js            fetch wrappers + HTML/JS escaping utilities
│       ├── config.js         Scoring config: defaults, fetch/save against /api/config
│       ├── scoring.js        The actual scoring curves + recompute()
│       ├── hero.js           Top banner: stat cards, badges, dynamic formula/methodology text
│       ├── filters.js        Exchange/Version filter bar
│       ├── parsers.js        Console-log and trades.json parsers
│       ├── addrun.js         "+ Add New Run" panel, auto-assigned Strategy labels
│       ├── summary.js        Run banner, grade dial, Quick Edit (rename/exchange/grind slots)
│       ├── settings.js       ⚙ Settings modal for scoring weights/thresholds
│       ├── nav.js            Run selection, subtab-preserving navigation
│       ├── tabs.js           Every detail tab: Pairs, Heatmap, Grind Analysis, etc.
│       ├── compare.js        Multi-run cumulative-equity comparison chart
│       └── app.js            init(), backup export/import
├── docs/images/               Screenshots + banner used in this README
├── requirements.txt
├── Dockerfile
└── docker-compose.yml
```

Plain `<script src="...">` tags, loaded in dependency order — no build step, no
bundler. Everything shares one global scope; the split is purely for readability and
navigation, not a different runtime model.

## Run it

### Option A: Docker (matches your existing NFI stack)

```bash
cd freqforge
docker compose up -d --build
```

Open `http://<your-machine-ip>:5055` from any device on your LAN.

Data lives in `./data/leverage_runs.db` on the host (bind-mounted), so it survives
container rebuilds/recreates same as your other services. Scoring config lives
alongside it in `./data/scoring_config.json`.

> **Upgrading from an older `nfix7-scorecard` deployment?** The Docker service name
> changed from `nfix7-scorecard` to `freqforge` as part of this rebrand. Run
> `docker compose down` against your **old** compose file first, then drop this
> update into the same project folder (so your existing `./data/` carries over
> automatically) before running `docker compose up -d --build` again — otherwise
> you'll end up with two containers instead of one replacing the other.

### Option B: Plain Python, no Docker

```bash
cd freqforge
pip install -r requirements.txt
python app.py
```

Open `http://localhost:5055`.

---

## Adding a run

Click **"+ ADD NEW RUN"** to expand the panel. Two files matter per run — only the
first is required, the second unlocks several extra detail tabs.

### Step 1 — run the backtest

```bash
# 5x
docker compose run --rm freqtrade_backtest_binance backtesting \
  --config user_data/config_back_test.json \
  --strategy NFIx7BackTest5x \
  --timerange 20250912-20260712 --timeframe 5m \
  --export trades --breakdown day \
  --backtest-filename user_data/backtest_results/leverage_test/baseline_5x \
  2>&1 | tee user_data/backtest_results/leverage_test/baseline_5x_console.log
```

This one command produces **two separate files you need**, in two different places:

| File | Where it lands | What it's for |
|---|---|---|
| `baseline_5x_console.log` | Exactly where you told it to (`leverage_test/`) — this is just your terminal's `tee` output | Load as the **console log** |
| `backtest-result-<timestamp>.zip` | `user_data/backtest_results/` (the parent folder, **not** `leverage_test/`) — freqtrade ignores `--backtest-filename` for this one and auto-names it | Extract → gives you the **trades JSON** |

### Step 2 — load the console log (required)

Paste its contents into the text box, or use the file picker.

### Step 3 — find and extract the trades JSON (optional, unlocks more tabs)

```bash
cd user_data/backtest_results
ls *.zip
```

To identify which zip is which, peek inside — the strategy filename gives it away:

```bash
unzip -l backtest-result-2026-07-12_20-52-42.zip
# look for something like: backtest-result-2026-07-12_20-52-42_NFIx7BackTest5x.py
```

Extract it, then load the **un-suffixed** `.json` file (not `_config.json`,
`_NFIx7BackTestNx.py`, or either `.feather` file):

```bash
mkdir -p extracted/5x
unzip -o backtest-result-2026-07-12_20-52-42.zip -d extracted/5x
```

### Step 4 — Strategy label auto-assigns itself, then save

Leave the **Strategy** field empty and click **Parse log** — it reads the leverage
straight from freqtrade's `"Using resolved strategy NFIx7BackTest5x"` line and the
NFI version from a one-line logger addition (see [NFI version
tracking](#nfi-version-tracking) below), producing something like
`NFIx7-5x-v17.4.413` automatically. Typing anything yourself is always respected and
never overwritten.

Fix anything with an amber border in the review panel, then **Save this run**.
Repeat for each leverage level.

---

## The tabs

Once a run is saved, click its tile to see:

| Tab | Needs trades.json? | What it shows |
|---|---|---|
| **Summary** | No | Grade dial, score breakdown, risk instrument panel |
| **Pairs** | No | Per-pair performance (from the log's `BACKTESTING REPORT` table) |
| **Heatmap** | No\* | Daily profit calendar (from `DAY BREAKDOWN`) |
| **Equity Curve** | No | Cumulative profit chart for this one run |
| **Yearly** | No | Daily data aggregated by calendar year |
| **Exit Reasons** | No\* | Exit-reason breakdown (from `EXIT REASON STATS`) |
| **Enter Tags** | No\* | Entry-tag breakdown (from `ENTER TAG STATS`) |
| **Winning Trades** | **Yes** | Every profitable trade, best first |
| **Losing Trades** | **Yes** | Every losing trade, worst first |
| **Grind Analysis** | **Yes** | Order-count/duration distributions, longest-held trades, click any trade for its full order sequence |
| **Monte Carlo** | **Yes** | Reshuffles your actual trades 1,000 times to test whether the reported max drawdown was luck of trade ordering or genuinely representative |

**\*** Heatmap, Exit Reasons, and Enter Tags work from the log alone, but freqtrade's
own tables are pair-agnostic. **If you've also loaded trades.json**, these three tabs
additionally show a **Pairs** column — which specific pairs contributed to each exit
reason, tag, or day.

![Heatmap](docs/images/screenshots/heatmap.png)

![Winning trades](docs/images/screenshots/winning-trades.png)

### Grind Analysis — order-level detail and long/short handling

Click any trade in the "Longest-Held Trades" table for a popup showing its full
buy/sell order sequence — side, price, amount, cost, and timestamp per order.
**Correctly handles short trades**: freqtrade's raw order side (`buy`/`sell`) means
the *opposite* thing depending on trade direction — a short's entry is a `sell`, its
exit is a `buy`. Coloring by literal side alone would show every short's normal
opening as if something had gone wrong. Instead it's colored by actual open/close
semantics, with an explicit LONG/SHORT badge and Entry/Exit column so there's no
ambiguity either way.

![Grind Analysis with order-sequence modal](docs/images/screenshots/grind-analysis.png)

---

## Monte Carlo trade-reshuffling

A backtest's reported max drawdown reflects one specific ordering of trades — the
order they actually happened to occur in. This tab takes your actual trade sequence
and randomly reshuffles it 1,000 times, recomputing max drawdown for each reshuffle.
Total profit is identical in every simulation (same trades, same sum) — only the
*path* changes, which reveals whether your reported drawdown was a lucky, unlucky, or
typical ordering:

- **Favorable ordering** (top ~20% of simulations) — your actual drawdown was better
  than nearly all alternatives. Treat the reported number as optimistic; real-world
  risk is plausibly higher than this backtest suggests.
- **Unfavorable ordering** (bottom ~20%) — your actual drawdown was worse than nearly
  all alternatives. The tough sequence genuinely happened, but typical risk for this
  trade set looks better than what this one run reported.
- **Typical ordering** (middle ~60%) — the reported drawdown is a reasonable,
  representative estimate either way.

Needs trades.json loaded (uses each trade's `profit_abs` and `open_date`). Starting
equity for the simulation uses the run's recorded deposit, falling back to $500 if
none is set.

![Monte Carlo Shuffeling modal](docs/images/screenshots/monte-carlo.png)

## Filtering and comparing runs

Once you have 4+ runs, an **Exchange / Version filter bar** appears above the run
tiles — narrows down the row instead of scrolling through everything.

With 2+ runs visible, a **📊 Comparison Chart** toggle appears: overlays every
currently-filtered run's cumulative equity curve on one chart with a color-coded
legend. Click any legend entry to jump straight to that run. Respects your active
filters — filter to just Bybit runs and the chart only plots those.

![Comparison chart](docs/images/screenshots/comparison-chart.png)

Needs day-level data (Heatmap data) loaded for at least 2 runs to have anything to
plot; runs missing it are listed as skipped rather than silently dropped. Dates align
by actual calendar date, so this works best comparing runs over the same backtest
window.

---

## Quick Edit

Click **✎ edit** next to any run's banner for lightweight fixes that don't require
re-parsing a log:

- **Rename** the run (safely cascades across every detail table — pairs, exits,
  enters, days, trades all move with it)
- **Exchange** — manual override if the parser ever misses it
- **Grind Mode Max Slots** — manual field for tracking NFI's `grind_mode_max_slots`
  strategy-config override per run (no log source exists for this, so it's
  manual-only)

---

## Scoring methodology

Each run is graded **independently** against fixed thresholds — never relative to
other runs in the database. **These are the defaults** — every weight and threshold
is editable in-app via **⚙ Settings**:

| Category | Default Weight | Default Scale |
|---|---|---|
| Sortino Ratio | 25% | 0→0pts, 1.5→50pts, 3.0+→100pts |
| Drawdown control | 25% | 0%→100pts, 10%→90pts, 20%→50pts, 40%→0pts |
| CAGR | 15% | log-scaled, 100%→50pts, 10000%+→100pts |
| Liquidation-safety | 15% | forced-exit rate; 0%→100pts, 10%+→0pts |
| Profit Factor | 10% | 1.0→20pts, 2.0→70pts, 10.0+→100pts |
| Worst-trade severity | 10% | `100 + worst_trade_%` (a -100% trade scores 0) |

Sortino is used instead of Sharpe (it only penalizes downside deviation). If
freqtrade reports the broken `-100.00` sentinel for Sortino (no downside deviation
observed), it's scored as 100 — best-in-class, not worst. The same logic applies to
Profit Factor when it shows exactly `0.00` alongside that sentinel: it usually means
a perfect win rate broke the ratio's division, not that the run was bad.

These thresholds are opinionated, not universal — there's no single industry-standard
formula for this. Calmar was deliberately excluded — at this leverage scale every run
blows past its "strong" threshold by 1000x+, adding no differentiation.

## Configuring the scoring

Click **⚙ Settings** to adjust category weights (must sum to 100, validated live) and
the curve thresholds that shape each category. Changes trigger a genuine recompute of
every run's grade, not just a display change — the formula line in the header and the
Methodology note at the bottom both regenerate live from current settings, so they
can never go stale.

![Settings panel](docs/images/screenshots/configuration.png)

Stored server-side in `data/scoring_config.json`, same volume as the database —
survives rebuilds, consistent across every device on your network.

---

## NFI version tracking

The scorecard parses a `nfi_version` field from a specific log line — but freqtrade
doesn't print this automatically. Add one small hook to your own `NFIx7BackTest.py`
(never touches the auto-updated `NostalgiaForInfinityX7.py`, so it survives your
`nfi-updater` pulling new releases):

```python
import logging
from NostalgiaForInfinityX7 import NostalgiaForInfinityX7

logger = logging.getLogger(__name__)

class NFIx7BackTestBase(NostalgiaForInfinityX7):
    def bot_start(self, **kwargs) -> None:
        super().bot_start(**kwargs)
        logger.info(f"NFI strategy version: {self.version()}")

class NFIx7BackTest3x(NFIx7BackTestBase):
    futures_mode_leverage = 3.0
    # ...same pattern for every leverage subclass
```

`bot_start()` is confirmed by freqtrade's own docs to fire once during backtesting,
right after data loads — this produces a log line like `NFI strategy version:
v17.4.413`, which the scorecard picks up automatically and uses both for display and
for auto-assigning Strategy labels.

## Pairlist fingerprint

Every trades.json includes the actual pairlist the run traded against. The scorecard
hashes it (order-independent) and warns directly in the run banner — **⚠ PAIRLIST
MISMATCH** — if a run's fingerprint differs from the majority of what's currently
loaded. This catches silent config drift (a backtest accidentally run against the
wrong pairlist file) automatically instead of requiring manual JSON diffing to spot.
Only works for runs with trades.json loaded.

---

## Backup

- **Export backup** (button in the Add Run panel) downloads a `.json` snapshot of
  every run in the database.
- **Import backup** merges one back in.
- Or just copy `data/leverage_runs.db` directly — it's a real SQLite file, works with
  any SQLite tooling.

---

## Notes / known limitations

- **The log parser matches freqtrade's Rich-rendered console tables** (Unicode
  box-drawing characters like `│`, not ASCII pipes). If a future freqtrade version
  changes its table formatting, the fix goes in `parseFreqtradeLog` in
  `static/js/parsers.js`. The manual-review step means a parser miss never blocks you
  from saving a run.
- **The trades.json parser expects freqtrade's standard export schema**
  (`{"strategy": {"<name>": {"trades": [...]}}}`). Verified against a real export,
  including `is_short` and per-order `ft_is_entry`/`ft_order_side` fields for correct
  long/short handling.
- **The in-app banner image** (`static/img/banner.png`) is a static file, not
  generated by the app — swap it for anything you like, just keep the filename.
- **Empty database ≠ unreachable server.** Deleting every run correctly leaves the
  database empty on reload — it won't silently repopulate with placeholder data.
- **Strategy label sorting** extracts the leverage number from anywhere in the label
  (not just the start), so both old-style (`3x-413`) and current (`NFIx7-3x-v17.4.413`)
  formats sort correctly side by side — you don't need to rename existing runs for
  anything to keep working.
