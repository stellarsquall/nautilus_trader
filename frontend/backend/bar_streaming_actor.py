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


class BarStreamingActorConfig(ActorConfig, kw_only=True, frozen=True):
    """
    Configuration for BarStreamingActor.

    Parameters
    ----------
    component_id : str, default "BAR_STREAMER"
        The component ID for the actor.
    delay_ms : int, default 50
        Delay in milliseconds after each bar emission for playback throttling.

    """

    component_id: str = "BAR_STREAMER"
    delay_ms: int = 50


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

    def on_bar(self, bar: Bar) -> None:
        """
        Handle bar event (runs on BacktestEngine worker thread).

        Creates an envelope with versioned protocol structure and enqueues it
        via thread-safe bridging to the main event loop. Sleeps for the
        configured delay to throttle playback.

        Parameters
        ----------
        bar : Bar
            The bar data to forward.

        """
        if self._queue is None or self._loop is None:
            self.log.error("Queue not injected, cannot stream bars")
            return

        # Increment sequence number
        self._seq += 1

        # Create envelope with protocol version 1
        envelope = {
            "v": 1,
            "type": "bar",
            "seq": self._seq,
            "payload": {
                "ts_event": bar.ts_event // 1_000_000,  # nanoseconds → milliseconds
                "open": float(bar.open),
                "high": float(bar.high),
                "low": float(bar.low),
                "close": float(bar.close),
                "volume": float(bar.volume),
            },
        }

        # Thread-safe enqueue from worker thread to main event loop
        self._loop.call_soon_threadsafe(self._queue.put_nowait, envelope)

        # Sleep on worker thread to create visible playback delay
        time.sleep(self._delay_seconds)
