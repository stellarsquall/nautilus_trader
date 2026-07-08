# -------------------------------------------------------------------------------------------------
#  Copyright (C) 2015-2026 Nautech Systems Pty Ltd. All rights reserved.
#  https://nautechsystems.io
#
#  Licensed under the GNU Lesser General Public License Version 3.0 (the "License");
#  You may not use this file except in compliance with the License.
#  You may obtain a copy of the License at https://www.gnu.org/licenses/lgpl-3.0.en.html
#
#  Unless required by applicable law or agreed to in writing, software
#  distributed under the License is distributed on an "AS IS" BASIS,
#  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
#  See the License for the specific language governing permissions and
#  limitations under the License.
# -------------------------------------------------------------------------------------------------

"""
Integration tests for dataset loading → bar streaming actor interaction.

These tests verify that the merged features interact correctly end-to-end:
- Dataset loading (issue/28218f97-01) provides trade-tick data in the right format
- Bar streaming actor aggregates trades and emits enriched bar + cvd envelopes
- Both ETHUSDT (CSV) and BTCUSDT (Parquet with bool coercion) work end-to-end

The actor bridges envelopes to the main event loop via `call_soon_threadsafe`,
so these tests MUST drive a running event loop while the backtest executes
(the engine runs in a thread-pool executor inside run_backtest_with_delay).
Draining the queue without a running loop yields nothing — that was the original
defect these tests now guard against.
"""

import asyncio
import gc
import math

import pytest

from nautilus_trader.model.enums import AggressorSide

from terminal.server.backtest import create_backtest_queue
from terminal.server.backtest import run_backtest_with_delay


def _run_and_collect(dataset: str) -> tuple[list, list]:
    """Run the full backtest on a live event loop and return (ticks, envelopes).

    Results are cached per-dataset for the module: several tests assert against
    the same dataset, and re-running a full 69k-trade backtest for each would be
    slow and can exhaust memory. Running each dataset once keeps the suite light.

    Drains every envelope (bar and cvd) until the EOF sentinel. delay_ms=0 keeps
    the run fast (ETHUSDT ≈ 299 bars, BTCUSDT a handful).
    """
    cached = _COLLECT_CACHE.get(dataset)
    if cached is not None:
        return cached

    loop = asyncio.new_event_loop()
    try:
        engine, queue = create_backtest_queue(loop, delay_ms=0, dataset=dataset)
        ticks = [d for d in engine.data if hasattr(d, "aggressor_side")]

        async def drive() -> list:
            # Run the backtest fully first. With delay_ms=0 the actor blitzes all
            # bars, scheduling envelope deliveries via call_soon_threadsafe; these
            # can settle around the EOF sentinel, so we do NOT break on None
            # mid-stream. Instead we run to completion, let pending threadsafe
            # callbacks flush, then drain everything non-blockingly.
            await run_backtest_with_delay(engine, queue, delay_ms=0)
            # Let pending threadsafe callbacks flush; drain until the queue stays
            # empty across two consecutive polls (all envelopes delivered).
            collected: list = []
            empty_polls = 0
            while empty_polls < 2:
                await asyncio.sleep(0.05)
                if queue.empty():
                    empty_polls += 1
                    continue
                empty_polls = 0
                while not queue.empty():
                    item = queue.get_nowait()
                    if item is not None:  # skip EOF sentinel(s)
                        collected.append(item)
            return collected

        envelopes = loop.run_until_complete(drive())
        _COLLECT_CACHE[dataset] = (ticks, envelopes)
        return ticks, envelopes
    finally:
        loop.close()
        gc.collect()


def _finite(value) -> bool:
    return isinstance(value, (int, float)) and math.isfinite(value)


# Per-dataset cache of (ticks, envelopes) so each full backtest runs at most once.
_COLLECT_CACHE: dict[str, tuple[list, list]] = {}


class TestDatasetActorIntegration:
    """Integration tests between dataset loading and bar streaming actor."""

    @pytest.mark.timeout(60)
    def test_ethusdt_dataset_streams_valid_bar_envelopes(self):
        """ETHUSDT dataset → engine → actor → queue produces valid bar envelopes."""
        ticks, envelopes = _run_and_collect("ethusdt")
        assert len(ticks) == 69_806, "ETHUSDT should have 69,806 trades"

        bars = [e for e in envelopes if e["type"] == "bar"]
        assert len(bars) > 0, "Should receive at least one bar envelope"

        for i, envelope in enumerate(bars):
            assert envelope["v"] == 1, f"Bar {i} should have version 1"
            assert envelope["type"] == "bar"
            assert "seq" in envelope and "payload" in envelope
            payload = envelope["payload"]
            for field in ("ts_event", "open", "high", "low", "close", "volume",
                          "buy_volume", "sell_volume", "delta"):
                assert field in payload, f"Bar {i} payload missing '{field}'"
                assert _finite(payload[field]), f"Bar {i} payload[{field}] not finite"

        # Global sequence numbers (across bar + cvd) are unique and monotonic.
        seq_numbers = [e["seq"] for e in envelopes]
        assert seq_numbers == sorted(seq_numbers), "seq should be monotonic"
        assert seq_numbers[0] == 1, "First sequence number should be 1"
        assert len(set(seq_numbers)) == len(seq_numbers), "seq should be unique"

    @pytest.mark.timeout(60)
    def test_btcusdt_dataset_with_bool_coercion_streams_correctly(self):
        """BTCUSDT parquet (bool coercion) → engine → actor → queue streams correctly."""
        ticks, envelopes = _run_and_collect("btcusdt")
        assert len(ticks) == 2_001, "BTCUSDT should have 2,001 trades"

        aggressor_sides = {tick.aggressor_side for tick in ticks}
        assert AggressorSide.BUYER in aggressor_sides, (
            "BUYER side should be present (bool coercion validation)"
        )
        assert AggressorSide.SELLER in aggressor_sides, (
            "SELLER side should be present (bool coercion validation)"
        )

        bars = [e for e in envelopes if e["type"] == "bar"]
        assert len(bars) > 0, "Should receive bar envelopes from BTCUSDT dataset"

        first = bars[0]
        assert first["v"] == 1
        assert first["type"] == "bar"
        assert "seq" in first and "payload" in first
        assert first["payload"]["volume"] > 0, (
            "Bar volume should be > 0 (validates trades aggregated correctly)"
        )

    @pytest.mark.timeout(60)
    def test_bar_type_last_internal_produces_valid_bars(self):
        """LAST-INTERNAL bars satisfy OHLC constraints and increasing timestamps."""
        _ticks, envelopes = _run_and_collect("ethusdt")
        bars = [e for e in envelopes if e["type"] == "bar"]
        assert len(bars) >= 1, "Should receive at least 1 bar"

        for i, envelope in enumerate(bars):
            payload = envelope["payload"]
            assert payload["low"] <= payload["high"], f"Bar {i}: low <= high"
            assert payload["low"] <= payload["open"], f"Bar {i}: low <= open"
            assert payload["low"] <= payload["close"], f"Bar {i}: low <= close"
            assert payload["high"] >= payload["open"], f"Bar {i}: high >= open"
            assert payload["high"] >= payload["close"], f"Bar {i}: high >= close"
            assert payload["volume"] > 0, f"Bar {i}: volume should be > 0"
            if i > 0:
                assert payload["ts_event"] > bars[i - 1]["payload"]["ts_event"], (
                    f"Bar {i}: timestamp should increase"
                )

    @pytest.mark.timeout(60)
    def test_actor_subscription_to_trade_ticks_and_bars(self):
        """Dual subscription (trades + bars) yields bar and cvd envelopes only."""
        _ticks, envelopes = _run_and_collect("ethusdt")
        bars = [e for e in envelopes if e["type"] == "bar"]
        assert len(bars) >= 1, "Should receive bar envelopes (validates bar subscription)"

        # The queue carries protocol envelopes (bar + cvd), never raw trade ticks.
        assert {e["type"] for e in envelopes} == {"bar", "cvd"}, (
            "Queue should only contain bar and cvd envelopes"
        )
        # Each bar is followed by exactly one cvd envelope.
        assert sum(1 for e in envelopes if e["type"] == "cvd") == len(bars)
