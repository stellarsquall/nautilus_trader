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

from nautilus_trader.backtest.config import BacktestEngineConfig
from nautilus_trader.backtest.engine import BacktestEngine
from nautilus_trader.model.currencies import USD
from nautilus_trader.model.data import BarType
from nautilus_trader.model.enums import AccountType
from nautilus_trader.model.enums import OmsType
from nautilus_trader.model.identifiers import TraderId
from nautilus_trader.model.identifiers import Venue
from nautilus_trader.model.objects import Money
from nautilus_trader.persistence.wranglers import QuoteTickDataWrangler
from nautilus_trader.test_kit.providers import TestDataProvider
from nautilus_trader.test_kit.providers import TestInstrumentProvider

from terminal.server.bar_streaming_actor import BarStreamingActor
from terminal.server.bar_streaming_actor import BarStreamingActorConfig


def create_backtest_queue(
    loop: asyncio.AbstractEventLoop,
    delay_ms: int = 50,
) -> tuple[BacktestEngine, asyncio.Queue]:
    """
    Create a BacktestEngine configured to stream 1-minute AUD/USD bars to a queue.

    Mirrors the setup from examples/backtest/fx_ema_cross_audusd_bars_from_ticks.py
    with INTERNAL bar aggregation from quote ticks. The engine is configured with
    a SIM venue, AUD/USD instrument, and historical quote tick data.

    Parameters
    ----------
    loop : asyncio.AbstractEventLoop
        The main event loop for thread-safe queue bridging.
    delay_ms : int, default 50
        Playback delay in milliseconds after each bar emission.

    Returns
    -------
    tuple[BacktestEngine, asyncio.Queue]
        The configured engine (ready to run) and the queue receiving bar envelopes.

    Notes
    -----
    - Dataset: tests/test_data/truefx/audusd-ticks.csv (~100k quote ticks, 2020-01-30/31)
    - BarType: AUD/USD.SIM-1-MINUTE-MID-INTERNAL (INTERNAL aggregation is critical)
    - Actor subscribes to bars and forwards to queue via call_soon_threadsafe
    - The engine is NOT started; caller must run engine.run() on a background thread

    """
    # Configure backtest engine
    config = BacktestEngineConfig(
        trader_id=TraderId("BACKTESTER-001"),
    )
    engine = BacktestEngine(config=config)

    # Add trading venue (SIM venue for FX instruments)
    SIM = Venue("SIM")
    engine.add_venue(
        venue=SIM,
        oms_type=OmsType.HEDGING,  # Venue generates position IDs
        account_type=AccountType.MARGIN,
        base_currency=USD,
        starting_balances=[Money(1_000_000, USD)],
    )

    # Add instrument
    AUDUSD_SIM = TestInstrumentProvider.default_fx_ccy("AUD/USD", SIM)
    engine.add_instrument(AUDUSD_SIM)

    # Add quote tick data
    provider = TestDataProvider()
    wrangler = QuoteTickDataWrangler(instrument=AUDUSD_SIM)
    ticks = wrangler.process(provider.read_csv_ticks("truefx/audusd-ticks.csv"))
    engine.add_data(ticks)

    # Create actor and queue
    queue = asyncio.Queue()
    actor_config = BarStreamingActorConfig(delay_ms=delay_ms)
    actor = BarStreamingActor(config=actor_config)
    actor.set_queue(queue, loop)

    # Register actor with engine
    engine.add_actor(actor)

    # Subscribe actor to 1-minute bars with INTERNAL aggregation
    bar_type = BarType.from_str("AUD/USD.SIM-1-MINUTE-MID-INTERNAL")
    actor.subscribe_bars(bar_type)

    return engine, queue


async def run_backtest_with_delay(
    engine: BacktestEngine,
    queue: asyncio.Queue,
    delay_ms: int = 50,
) -> None:
    """
    Run backtest in a thread executor with per-bar playback delay.

    BacktestEngine.run() is a blocking, synchronous call that processes
    all data in a tight loop. To avoid blocking the asyncio event loop,
    this function wraps the run in a ThreadPoolExecutor. The actual
    per-bar delay is implemented inside the BarStreamingActor's on_bar
    callback.

    Parameters
    ----------
    engine : BacktestEngine
        The configured backtest engine (already has venue, instrument, data, actor).
    queue : asyncio.Queue
        The queue that receives bar envelopes from the actor (via call_soon_threadsafe).
    delay_ms : int, default 50
        Milliseconds to sleep after each bar is emitted (configured in actor).
        This parameter is kept for API consistency but the delay is actually
        applied by the actor, not this function.

    Implementation Strategy
    -----------------------
    1. The BarStreamingActor calls on_bar() for each bar, which enqueues via
       call_soon_threadsafe (thread-safe bridge from worker thread to event loop).
    2. After each bar, the actor sleeps for delay_ms milliseconds on the worker thread.
    3. BacktestEngine.run() blocks the worker thread until all data is processed.
    4. This coroutine wraps engine.run() in a ThreadPoolExecutor to avoid blocking
       the asyncio event loop that serves WebSocket connections.

    Notes
    -----
    - The delay is implemented INSIDE the actor's on_bar callback, not here.
    - This function ensures engine.run() runs on a background thread.
    - After backtest completes, None is enqueued as an EOF signal to consumers.

    """
    loop = asyncio.get_running_loop()

    # Run blocking engine.run() on a thread pool to avoid blocking event loop
    await loop.run_in_executor(None, engine.run)

    # After backtest completes, signal EOF to queue consumers
    await queue.put(None)
