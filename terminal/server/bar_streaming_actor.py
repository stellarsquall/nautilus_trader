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

    """

    component_id: str = "BAR_STREAMER"
    delay_ms: int = 50
    bar_interval_ms: int = 60_000
    instrument_id: str | None = None
    bar_type: str | None = None


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

        # Per-minute trade aggregation buckets, keyed by the minute-floor of the
        # trade's ts_event (ns). Each bucket accumulates buy/sell volume by
        # aggressor side. Cleared bucket-by-bucket as each bar closes.
        self._buckets: dict[int, dict[str, float]] = {}

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
        keyed by the minute-floor of its ts_event. The bucket is drained when
        the corresponding bar closes in `on_bar`.

        Parameters
        ----------
        tick : TradeTick
            The trade tick to aggregate.

        """
        minute_key = (tick.ts_event // self._interval_ns) * self._interval_ns
        bucket = self._buckets.setdefault(
            minute_key,
            {"buy_volume": 0.0, "sell_volume": 0.0},
        )
        size = float(tick.size)
        if tick.aggressor_side == AggressorSide.BUYER:
            bucket["buy_volume"] += size
        elif tick.aggressor_side == AggressorSide.SELLER:
            bucket["sell_volume"] += size

    def on_bar(self, bar: Bar) -> None:
        """
        Handle bar event (runs on BacktestEngine worker thread).

        Correlates the closing bar to its per-minute trade bucket, computes the
        bar delta (buy_volume - sell_volume), advances the session-cumulative
        CVD, then emits TWO envelopes via thread-safe bridging to the main event
        loop: an enriched `bar` envelope (OHLCV + order-flow fields) followed by
        a `cvd` envelope. Both share the global monotonic sequence counter, so
        the cvd seq is always one greater than its bar seq. Sleeps for the
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
        # bucket (pop) to free memory; a missing bucket defaults to zero volume.
        bar_start_ns = bar.ts_event - self._interval_ns
        bucket = self._buckets.pop(
            bar_start_ns,
            {"buy_volume": 0.0, "sell_volume": 0.0},
        )
        buy_volume = bucket["buy_volume"]
        sell_volume = bucket["sell_volume"]
        delta = buy_volume - sell_volume

        # Advance session-cumulative CVD.
        self._cvd += delta

        ts_ms = bar.ts_event // 1_000_000  # nanoseconds → milliseconds

        # Enriched bar envelope (additive: existing consumers ignore the new
        # order-flow fields, so the protocol version stays 1).
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
                "buy_volume": buy_volume,
                "sell_volume": sell_volume,
                "delta": delta,
            },
        }
        self._loop.call_soon_threadsafe(self._queue.put_nowait, bar_envelope)

        # CVD envelope (new type, reserved in the client Envelope union).
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

        # Sleep on worker thread to create visible playback delay
        time.sleep(self._delay_seconds)