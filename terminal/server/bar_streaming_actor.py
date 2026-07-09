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

import asyncio
import time

from nautilus_trader.common.actor import Actor
from nautilus_trader.config import ActorConfig
from nautilus_trader.model.data import Bar
from nautilus_trader.model.data import BarType
from nautilus_trader.model.data import TradeTick
from nautilus_trader.model.enums import AggressorSide
from nautilus_trader.model.identifiers import InstrumentId


class BarStreamingActorConfig(ActorConfig, kw_only=True, frozen=True):
    """
    Configuration for BarStreamingActor.

    Parameters
    ----------
    component_id : str, default "BAR_STREAMER"
        The component ID for the actor.
    delay_ms : int, default 50
        Delay in milliseconds after each bar emission for playback throttling.
    bar_interval_ms : int, default 60_000
        The bar aggregation interval in milliseconds. MUST match the subscribed
        BarType's interval (e.g. 60_000 for 1-MINUTE, 1_000 for 1-SECOND). Used
        to bucket trades and correlate each closing bar to its trade window.
    instrument_id : str or None, default None
        The instrument to subscribe trade ticks for (subscribed in on_start).
    bar_type : str or None, default None
        The bar type to subscribe (subscribed in on_start). Subscriptions MUST
        happen in on_start (not before engine.run), otherwise INTERNAL bar
        aggregators can backfill empty intervals and blow up memory.
    price_bin_size : float, default 0.1
        The price bin width for footprint aggregation. Trades are bucketed
        by bin_index = floor(price / price_bin_size) within each time window.
        The typical production value is 10 * instrument.price_increment.

    """

    component_id: str = "BAR_STREAMER"
    delay_ms: int = 50
    bar_interval_ms: int = 60_000
    instrument_id: str | None = None
    bar_type: str | None = None
    price_bin_size: float = 0.1


class BarStreamingActor(Actor):
    """
    Actor that forwards bars to an asyncio.Queue with thread-safe bridging.

    This actor runs on the BacktestEngine worker thread and uses
    `call_soon_threadsafe` to bridge bars to the main event loop's queue.
    A configurable playback delay is applied after each bar emission to make
    progressive chart population visible.

    Parameters
    ----------
    config : BarStreamingActorConfig
        The configuration for the actor.

    """

    def __init__(self, config: BarStreamingActorConfig) -> None:
        super().__init__(config)
        self._queue: asyncio.Queue | None = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._seq: int = 0
        self._delay_seconds: float = config.delay_ms / 1000.0

        # Bar aggregation interval in nanoseconds (bucket width and bar-to-bucket
        # correlation offset). Defaults to one minute.
        self._interval_ns: int = config.bar_interval_ms * 1_000_000

        # Price bin width for footprint aggregation.
        self._price_bin_size: float = config.price_bin_size

        # Per-minute trade aggregation buckets, keyed by the minute-floor of the
        # trade's ts_event (ns). Each bucket maps price bin_index to
        # {buy_volume, sell_volume} by aggressor side. Cleared bucket-by-bucket
        # as each bar closes.
        self._buckets: dict[int, dict[int, dict[str, float]]] = {}

        # Session-cumulative volume delta (CVD): running sum of per-bar deltas.
        self._cvd: float = 0.0

        # Subscription targets (subscribed in on_start, per nautilus contract).
        self._instrument_id_str: str | None = config.instrument_id
        self._bar_type_str: str | None = config.bar_type

    def on_start(self) -> None:
        """
        Subscribe to data feeds once the actor is started.

        Subscriptions MUST occur here rather than before engine.run(): calling
        subscribe_bars() on an INTERNAL aggregator too early can make it backfill
        every empty interval from an epoch reference (catastrophic at 1-SECOND).
        """
        if self._bar_type_str is not None:
            self.subscribe_bars(BarType.from_str(self._bar_type_str))
        if self._instrument_id_str is not None:
            self.subscribe_trade_ticks(InstrumentId.from_str(self._instrument_id_str))

    def set_queue(
        self,
        queue: asyncio.Queue,
        loop: asyncio.AbstractEventLoop,
    ) -> None:
        """
        Inject queue and event loop at runtime.

        Queue and event loop cannot be serialized in config, so they are
        injected before the engine runs.

        Parameters
        ----------
        queue : asyncio.Queue
            The queue to receive bar envelopes.
        loop : asyncio.AbstractEventLoop
            The main event loop for thread-safe queue operations.

        """
        self._queue = queue
        self._loop = loop

    def on_trade_tick(self, tick: TradeTick) -> None:
        """
        Handle trade tick event (runs on BacktestEngine worker thread).

        Buckets the trade's size into buy or sell volume by aggressor side,
        keyed by the minute-floor of its ts_event AND price bin index
        (floor(price / price_bin_size)). The bucket is drained when the
        corresponding bar closes in `on_bar`.

        Parameters
        ----------
        tick : TradeTick
            The trade tick to aggregate.

        """
        minute_key = (tick.ts_event // self._interval_ns) * self._interval_ns
        bin_index = int(float(tick.price) / self._price_bin_size)
        minute_bucket = self._buckets.setdefault(minute_key, {})
        price_bucket = minute_bucket.setdefault(
            bin_index,
            {"buy": 0.0, "sell": 0.0},
        )
        size = float(tick.size)
        if tick.aggressor_side == AggressorSide.BUYER:
            price_bucket["buy"] += size
        elif tick.aggressor_side == AggressorSide.SELLER:
            price_bucket["sell"] += size

    def on_bar(self, bar: Bar) -> None:
        """
        Handle bar event (runs on BacktestEngine worker thread).

        Correlates the closing bar to its per-minute trade price-bucket,
        aggregates all price bins for total buy/sell volume, computes the bar
        delta (buy_volume - sell_volume), advances the session-cumulative CVD,
        then emits THREE envelopes via thread-safe bridging: bar, cvd, and
        footprint. The footprint envelope contains per-bin level data. All
        three share the global monotonic sequence counter. Sleeps for the
        configured delay to throttle playback.

        Parameters
        ----------
        bar : Bar
            The bar data to forward.

        """
        if self._queue is None or self._loop is None:
            self.log.error("Queue not injected, cannot stream bars")
            return

        # Correlate this bar to the trade bucket for its interval. A time bar's
        # ts_event is the interval CLOSE, so the matching bucket key is
        # ts_event - interval (verified against real Binance data). Drain the
        # bucket (pop) to free memory; a missing bucket defaults to empty dict.
        bar_start_ns = bar.ts_event - self._interval_ns
        price_bins = self._buckets.pop(bar_start_ns, {})
        total_buy = sum(b["buy"] for b in price_bins.values())
        total_sell = sum(b["sell"] for b in price_bins.values())
        delta = total_buy - total_sell

        # Advance session-cumulative CVD.
        self._cvd += delta

        ts_ms = bar.ts_event // 1_000_000  # nanoseconds → milliseconds

        # 1. Enriched bar envelope
        self._seq += 1
        bar_envelope = {
            "v": 1,
            "type": "bar",
            "seq": self._seq,
            "payload": {
                "ts_event": ts_ms,
                "open": float(bar.open),
                "high": float(bar.high),
                "low": float(bar.low),
                "close": float(bar.close),
                "volume": float(bar.volume),
                "buy_volume": total_buy,
                "sell_volume": total_sell,
                "delta": delta,
            },
        }
        self._loop.call_soon_threadsafe(self._queue.put_nowait, bar_envelope)

        # 2. CVD envelope
        self._seq += 1
        cvd_envelope = {
            "v": 1,
            "type": "cvd",
            "seq": self._seq,
            "payload": {
                "ts_event": ts_ms,
                "cvd": self._cvd,
                "delta": delta,
            },
        }
        self._loop.call_soon_threadsafe(self._queue.put_nowait, cvd_envelope)

        # 3. Footprint envelope (seq = previous_cvd_seq + 1)
        levels = sorted(
            [
                {"price": bin_idx * self._price_bin_size, "buy": v["buy"], "sell": v["sell"]}
                for bin_idx, v in price_bins.items()
                if v["buy"] > 0 or v["sell"] > 0
            ],
            key=lambda x: x["price"],
        )
        self._seq += 1
        footprint_envelope = {
            "v": 1,
            "type": "footprint",
            "seq": self._seq,
            "payload": {
                "ts_event": ts_ms,
                "bin_size": self._price_bin_size,
                "levels": levels,
            },
        }
        self._loop.call_soon_threadsafe(self._queue.put_nowait, footprint_envelope)

        # Sleep on worker thread to create visible playback delay
        time.sleep(self._delay_seconds)