"""
NFIx7BackTest.py — leverage wrapper classes for NostalgiaForInfinityX7, built for use
with FreqForge (https://github.com/your-org/freqforge or wherever this scorecard lives).

WHERE THIS GOES
    Place this file in the same folder as your NostalgiaForInfinityX7.py — normally
    your freqtrade strategies directory (wherever "Using resolved strategy
    NostalgiaForInfinityX7 from '/freqtrade/NostalgiaForInfinityX7.py'" is pointing to
    in your own logs — that directory is where this file needs to sit too).

WHY IT EXISTS
    1. NFIx7Version logs the strategy's own version() string once per backtest run,
       via freqtrade's bot_start() hook (confirmed by freqtrade's own docs to fire
       once during backtesting, right after data loads). FreqForge parses this line
       to auto-fill the NFI Version field and auto-generate Strategy labels. Without
       it, freqtrade never prints this on its own.
    2. The leverage subclasses below (NFIx7BackTest2x, 3x, 5x, 10x, 15x) are what you
       point --strategy at for futures backtests at a specific leverage. Each is just
       NFIx7Version with futures_mode_leverage set — no other logic changes.

HOW TO USE IT
    Futures, at a specific leverage — point --strategy at the matching subclass:
        --strategy NFIx7BackTest3x
        --strategy NFIx7BackTest5x
        (etc. — add more classes below following the same pattern if you test other
        leverage levels; each one only needs the three leverage lines changed)

    Spot — point --strategy directly at NFIx7Version (skip the subclasses entirely):
        --strategy NFIx7Version

    Either way, FreqForge will auto-detect leverage from the class name for futures
    (e.g. "NFIx7BackTest3x" -> "3x"), or fall back to "SPOT" when trading mode is spot
    and no leverage number is present in the class name.

STAYING IN SYNC WITH NFI UPDATES
    This file only imports from NostalgiaForInfinityX7 — it never edits that file
    directly, so your nfi-updater pulling new NFI releases won't touch or break
    anything here. If NFI's version() method or class name ever changes, this file
    would need a matching update, but ordinary strategy-logic updates won't affect it.
"""

import logging

from NostalgiaForInfinityX7 import NostalgiaForInfinityX7

logger = logging.getLogger(__name__)


class NFIx7Version(NostalgiaForInfinityX7):
    """Base class: identical behavior to NostalgiaForInfinityX7, plus one thing —
    logs the strategy version once per run so FreqForge can pick it up automatically.
    Use this directly (no leverage) for spot backtests."""

    def bot_start(self, **kwargs) -> None:
        super().bot_start(**kwargs)
        logger.info(f"NFI strategy version: {self.version()}")


class NFIx7BackTest2x(NFIx7Version):
    futures_mode_leverage = 2.0
    futures_mode_leverage_rebuy_mode = 2.0
    futures_mode_leverage_grind_mode = 2.0


class NFIx7BackTest3x(NFIx7Version):
    futures_mode_leverage = 3.0
    futures_mode_leverage_rebuy_mode = 3.0
    futures_mode_leverage_grind_mode = 3.0


class NFIx7BackTest5x(NFIx7Version):
    futures_mode_leverage = 5.0
    futures_mode_leverage_rebuy_mode = 5.0
    futures_mode_leverage_grind_mode = 5.0


class NFIx7BackTest10x(NFIx7Version):
    futures_mode_leverage = 10.0
    futures_mode_leverage_rebuy_mode = 10.0
    futures_mode_leverage_grind_mode = 10.0


class NFIx7BackTest15x(NFIx7Version):
    futures_mode_leverage = 15.0
    futures_mode_leverage_rebuy_mode = 15.0
    futures_mode_leverage_grind_mode = 15.0
