"""
FreqForge — backend
Small Flask app backed by a real SQLite file. Serves the dashboard (static/index.html)
and a JSON API the frontend talks to for storing/reading backtest runs.

Run directly:
    pip install -r requirements.txt
    python app.py
    -> http://localhost:5055

Or via Docker (see Dockerfile / docker-compose.yml).
"""

import sqlite3
import os
import json
import logging
from pathlib import Path
from flask import Flask, jsonify, request, g, send_from_directory

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

try:
    import requests
except ImportError:
    print(
        "\n"
        "ERROR: the 'requests' package is missing.\n"
        "\n"
        "If you're running FreqForge via Docker, this shouldn't happen — try:\n"
        "    docker compose up -d --build\n"
        "(--build forces a fresh dependency install; without it, an old image can stick around)\n"
        "\n"
        "If you're running plain Python (no Docker) and this is an existing install being\n"
        "updated rather than a fresh one, this dependency is new as of the price-chart\n"
        "feature and won't be there yet just from restarting the app. Run:\n"
        "    pip install -r requirements.txt\n"
        "then start app.py again.\n"
    )
    raise SystemExit(1)

BASE_DIR = Path(__file__).parent
DB_PATH = os.environ.get("SCORECARD_DB_PATH", str(BASE_DIR / "data" / "leverage_runs.db"))
CONFIG_PATH = os.environ.get("SCORECARD_CONFIG_PATH", str(BASE_DIR / "data" / "scoring_config.json"))
Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)

app = Flask(__name__, static_folder=str(BASE_DIR / "static"), static_url_path="")

FIELDS = [
    "cagr", "sharpe", "sortino", "calmar", "maxdd", "pf", "sqn",
    "trades", "win_days", "lose_days", "worst_trade",
    "liq_count", "sl_count", "final_bal",
    "period_start", "period_end", "max_trades", "deposit", "exchange", "nfi_version",
    "pairlist_count", "pairlist_hash", "grind_mode_max_slots", "p_value",
    "expectancy", "expectancy_ratio", "max_consecutive_wins", "max_consecutive_losses",
    "winner_holding_avg", "loser_holding_avg", "market_type", "strategy_family",
]
TEXT_FIELDS = {"period_start", "period_end", "exchange", "pairlist_hash", "nfi_version", "winner_holding_avg", "loser_holding_avg", "market_type", "strategy_family"}


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(exception=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute(f"""
        CREATE TABLE IF NOT EXISTS runs (
            lev TEXT PRIMARY KEY,
            cagr REAL,
            sharpe REAL,
            sortino REAL,
            calmar REAL,
            maxdd REAL,
            pf REAL,
            sqn REAL,
            trades INTEGER,
            win_days INTEGER,
            lose_days INTEGER,
            worst_trade REAL,
            liq_count INTEGER,
            sl_count INTEGER,
            final_bal REAL,
            period_start TEXT,
            period_end TEXT,
            max_trades INTEGER,
            deposit REAL,
            exchange TEXT,
            nfi_version TEXT,
            pairlist_count REAL,
            pairlist_hash TEXT,
            grind_mode_max_slots REAL,
            p_value REAL,
            expectancy REAL,
            expectancy_ratio REAL,
            max_consecutive_wins REAL,
            max_consecutive_losses REAL,
            winner_holding_avg TEXT,
            loser_holding_avg TEXT,
            market_type TEXT,
            strategy_family TEXT,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)
    # MIGRATION: CREATE TABLE IF NOT EXISTS only helps brand-new databases — it does
    # nothing to a table that already exists with an older schema. Explicitly check for
    # and add any columns that are missing, so upgrading the app never silently breaks
    # existing data the way it just did.
    existing_cols = {row[1] for row in conn.execute("PRAGMA table_info(runs)")}
    for field in FIELDS:
        if field not in existing_cols:
            col_type = "TEXT" if field in TEXT_FIELDS else "REAL"
            conn.execute(f"ALTER TABLE runs ADD COLUMN {field} {col_type}")
            print(f"[migration] added missing column '{field}' ({col_type}) to runs table")
    conn.commit()
    # generic shape shared by pairs / exit-reasons / enter-tags
    for tbl in ("pair_stats", "exit_stats", "enter_stats"):
        conn.execute(f"""
            CREATE TABLE IF NOT EXISTS {tbl} (
                lev TEXT, label TEXT, count INTEGER, avg_profit_pct REAL,
                tot_profit_usdt REAL, tot_profit_pct REAL, duration TEXT,
                win INTEGER, draw INTEGER, loss INTEGER, win_pct REAL
            )
        """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS day_stats (
            lev TEXT, day TEXT, trades INTEGER, tot_profit_usdt REAL,
            profit_factor REAL, win INTEGER, draw INTEGER, loss INTEGER, win_pct REAL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS trades (
            lev TEXT, pair TEXT, profit_pct REAL, profit_abs REAL,
            open_date TEXT, close_date TEXT, exit_reason TEXT, enter_tag TEXT, duration_min REAL
        )
    """)
    trades_cols = {row[1] for row in conn.execute("PRAGMA table_info(trades)")}
    if "order_count" not in trades_cols:
        conn.execute("ALTER TABLE trades ADD COLUMN order_count REAL")
        print("[migration] added missing column 'order_count' to trades table")
    if "orders_json" not in trades_cols:
        conn.execute("ALTER TABLE trades ADD COLUMN orders_json TEXT")
        print("[migration] added missing column 'orders_json' to trades table")
    if "is_short" not in trades_cols:
        conn.execute("ALTER TABLE trades ADD COLUMN is_short REAL")
        print("[migration] added missing column 'is_short' to trades table")
    conn.commit()
    conn.close()


DETAIL_TABLES = {
    "pairs": "pair_stats", "exits": "exit_stats", "enters": "enter_stats",
    "days": "day_stats", "trades": "trades",
}


@app.route("/api/runs/<lev>/detail/<kind>", methods=["GET"])
def get_detail(lev, kind):
    tbl = DETAIL_TABLES.get(kind)
    if not tbl:
        return jsonify({"error": "unknown kind"}), 400
    db = get_db()
    rows = db.execute(f"SELECT * FROM {tbl} WHERE lev = ?", (lev,)).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/api/runs/<lev>/detail/<kind>", methods=["PUT"])
def put_detail(lev, kind):
    tbl = DETAIL_TABLES.get(kind)
    if not tbl:
        return jsonify({"error": "unknown kind"}), 400
    rows = request.get_json(force=True) or []
    db = get_db()
    # Column names can't be parameterized in SQL the way values can (placeholders only
    # work for values) — so instead of trying to escape/sanitize arbitrary column names
    # from the request body, validate them against the table's own real schema first.
    # Anything not an actual column on this table never reaches the SQL string at all.
    valid_cols = {row[1] for row in db.execute(f"PRAGMA table_info({tbl})")} - {"lev"}
    db.execute(f"DELETE FROM {tbl} WHERE lev = ?", (lev,))
    for row in rows:
        cols = [c for c in row.keys() if c in valid_cols]
        if not cols:
            continue
        placeholders = ", ".join("?" for _ in cols)
        col_names = ", ".join(cols)
        db.execute(f"INSERT INTO {tbl} (lev, {col_names}) VALUES (?, {placeholders})",
                   [lev, *[row[c] for c in cols]])
    db.commit()
    return jsonify({"ok": True, "count": len(rows)})


DEFAULT_SCORING_CONFIG = {
    "weights": {"cagr": 15, "sortino": 25, "dd": 25, "liq": 15, "pf": 10, "worst": 10},
    "cagr_max_threshold": 10000,
    "sortino_acceptable": 1.5,
    "sortino_strong": 3.0,
    "drawdown_strong_at": 10,
    "drawdown_zero_score_at": 40,
    "liquidation_zero_score_at": 10,
    "pf_max_threshold": 10.0,
}


@app.route("/api/config", methods=["GET"])
def get_config():
    if not os.path.exists(CONFIG_PATH):
        return jsonify(DEFAULT_SCORING_CONFIG)
    try:
        with open(CONFIG_PATH) as f:
            cfg = json.load(f)
        # merge over defaults so a partially-saved/older file never leaves a field missing
        merged = {**DEFAULT_SCORING_CONFIG, **cfg}
        merged["weights"] = {**DEFAULT_SCORING_CONFIG["weights"], **cfg.get("weights", {})}
        return jsonify(merged)
    except (json.JSONDecodeError, OSError) as e:
        logger.warning(f"Scoring config file unreadable, falling back to defaults: {e}")
        return jsonify({"error": "Config file unreadable — using default scoring weights instead. Check server logs for details.", **DEFAULT_SCORING_CONFIG}), 200


@app.route("/api/config", methods=["PUT"])
def put_config():
    body = request.get_json(force=True) or {}
    weights = body.get("weights", {})
    total = sum(weights.get(k, 0) for k in ["cagr", "sortino", "dd", "liq", "pf", "worst"])
    if abs(total - 100) > 0.5:
        return jsonify({"ok": False, "error": f"weights must sum to 100 (currently {total})"}), 400
    Path(CONFIG_PATH).parent.mkdir(parents=True, exist_ok=True)
    with open(CONFIG_PATH, "w") as f:
        json.dump(body, f, indent=2)
    return jsonify({"ok": True})


@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.route("/api/runs", methods=["GET"])
def list_runs():
    db = get_db()
    rows = db.execute("SELECT * FROM runs").fetchall()
    out = {}
    for row in rows:
        d = dict(row)
        lev = d.pop("lev")
        d.pop("updated_at", None)
        out[lev] = d
    return jsonify(out)


NULLABLE_NUMERIC_FIELDS = {"p_value", "expectancy", "expectancy_ratio", "max_consecutive_wins", "max_consecutive_losses"}  # 0 is a meaningful real value for these — missing must stay NULL, not default to 0


@app.route("/api/runs/<lev>", methods=["PUT"])
def upsert_run(lev):
    body = request.get_json(force=True) or {}
    def default_for(f):
        if f in TEXT_FIELDS: return ""
        if f in NULLABLE_NUMERIC_FIELDS: return None
        return 0
    values = [body.get(f, default_for(f)) for f in FIELDS]
    db = get_db()
    placeholders = ", ".join("?" for _ in FIELDS)
    col_names = ", ".join(FIELDS)
    update_clause = ", ".join(f"{f}=excluded.{f}" for f in FIELDS)
    try:
        db.execute(
            f"""INSERT INTO runs (lev, {col_names}, updated_at)
                VALUES (?, {placeholders}, CURRENT_TIMESTAMP)
                ON CONFLICT(lev) DO UPDATE SET {update_clause}, updated_at=CURRENT_TIMESTAMP""",
            [lev, *values],
        )
        db.commit()
    except sqlite3.OperationalError as e:
        logger.error(f"Failed to save run '{lev}': {e}")
        return jsonify({"ok": False, "error": "Could not save this run — check server logs for details."}), 500
    return jsonify({"ok": True, "lev": lev})


@app.route("/api/runs/<lev>", methods=["PATCH"])
def patch_run(lev):
    """Partial update — only touches the fields actually sent, unlike PUT which
    requires (and zeroes-out-if-missing) every field. Use this for quick manual
    edits like exchange, without needing to re-parse an entire log."""
    body = request.get_json(force=True) or {}
    fields_to_update = {k: v for k, v in body.items() if k in FIELDS}
    if not fields_to_update:
        return jsonify({"ok": False, "error": "no valid fields in request"}), 400
    db = get_db()
    existing = db.execute("SELECT 1 FROM runs WHERE lev = ?", (lev,)).fetchone()
    if not existing:
        return jsonify({"ok": False, "error": f"run '{lev}' not found"}), 404
    set_clause = ", ".join(f"{k}=?" for k in fields_to_update)
    db.execute(f"UPDATE runs SET {set_clause}, updated_at=CURRENT_TIMESTAMP WHERE lev = ?",
               [*fields_to_update.values(), lev])
    db.commit()
    return jsonify({"ok": True, "lev": lev, "updated": list(fields_to_update.keys())})


@app.route("/api/runs/<lev>/rename", methods=["POST"])
def rename_run(lev):
    """Renames a run's leverage label, cascading across the main runs table and
    every detail table (pairs/exits/enters/days/trades all key off lev)."""
    body = request.get_json(force=True) or {}
    new_lev = (body.get("new_lev") or "").strip()
    if not new_lev:
        return jsonify({"ok": False, "error": "new_lev is required"}), 400
    db = get_db()
    existing = db.execute("SELECT 1 FROM runs WHERE lev = ?", (lev,)).fetchone()
    if not existing:
        return jsonify({"ok": False, "error": f"run '{lev}' not found"}), 404
    clash = db.execute("SELECT 1 FROM runs WHERE lev = ?", (new_lev,)).fetchone()
    if clash:
        return jsonify({"ok": False, "error": f"a run named '{new_lev}' already exists"}), 409
    db.execute("UPDATE runs SET lev = ? WHERE lev = ?", (new_lev, lev))
    for tbl in DETAIL_TABLES.values():
        db.execute(f"UPDATE {tbl} SET lev = ? WHERE lev = ?", (new_lev, lev))
    db.commit()
    return jsonify({"ok": True, "old_lev": lev, "new_lev": new_lev})


@app.route("/api/runs/<lev>", methods=["DELETE"])
def delete_run(lev):
    db = get_db()
    db.execute("DELETE FROM runs WHERE lev = ?", (lev,))
    for tbl in DETAIL_TABLES.values():
        db.execute(f"DELETE FROM {tbl} WHERE lev = ?", (lev,))
    db.commit()
    return jsonify({"ok": True})


@app.route("/api/export", methods=["GET"])
def export_all():
    return list_runs()


@app.route("/api/import", methods=["POST"])
def import_all():
    body = request.get_json(force=True) or {}
    db = get_db()
    for lev, metrics in body.items():
        values = [metrics.get(f, 0) for f in FIELDS]
        placeholders = ", ".join("?" for _ in FIELDS)
        col_names = ", ".join(FIELDS)
        update_clause = ", ".join(f"{f}=excluded.{f}" for f in FIELDS)
        db.execute(
            f"""INSERT INTO runs (lev, {col_names}, updated_at)
                VALUES (?, {placeholders}, CURRENT_TIMESTAMP)
                ON CONFLICT(lev) DO UPDATE SET {update_clause}, updated_at=CURRENT_TIMESTAMP""",
            [lev, *values],
        )
    db.commit()
    return jsonify({"ok": True, "imported": len(body)})


@app.route("/api/candles", methods=["GET"])
def get_candles():
    """Proxies historical OHLCV candles from Binance's public API. Done server-side
    rather than having the browser fetch Binance directly — CORS support on Binance's
    public endpoints has been inconsistently reported as working/broken over time by
    other developers, and Python's requests library has no CORS restriction at all
    (that's a browser-only mechanism), so proxying here is the more reliable path
    regardless of Binance's current CORS policy."""
    pair = request.args.get("pair", "")
    interval = request.args.get("interval", "15m")
    start_ts = request.args.get("start_ts", type=int)
    end_ts = request.args.get("end_ts", type=int)

    if not pair or not start_ts or not end_ts:
        return jsonify({"error": "pair, start_ts, and end_ts are required"}), 400

    # Freqtrade pair notation -> Binance symbol: "BTC/USDT:USDT" (futures) or
    # "BTC/USDT" (spot) both need to become "BTCUSDT" for Binance's API.
    is_futures = ":" in pair
    symbol = pair.split(":")[0].replace("/", "")
    base_url = "https://fapi.binance.com/fapi/v1/klines" if is_futures else "https://api.binance.com/api/v3/klines"

    try:
        resp = requests.get(base_url, params={
            "symbol": symbol, "interval": interval,
            "startTime": start_ts, "endTime": end_ts, "limit": 500,
        }, timeout=10)
        if not resp.ok:
            logger.warning(f"Binance API error for {symbol} ({base_url}): {resp.status_code} — {resp.text[:300]}")
            return jsonify({"error": f"Binance API returned {resp.status_code}. Check server logs for the full response."}), 502
        raw = resp.json()
    except requests.RequestException as e:
        logger.warning(f"Could not reach Binance ({base_url}) for {symbol}: {e}")
        return jsonify({"error": "Could not reach Binance. Check server logs for details, or that this server has outbound internet access."}), 502

    candles = [{
        "time": row[0], "open": float(row[1]), "high": float(row[2]),
        "low": float(row[3]), "close": float(row[4]), "volume": float(row[5]),
    } for row in raw]
    return jsonify({"symbol": symbol, "market": "futures" if is_futures else "spot", "candles": candles})


if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5055)), debug=False, threaded=True)
else:
    init_db()
