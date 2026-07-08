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

import pandas as pd

from nautilus_trader.backtest.config import BacktestEngineConfig
from nautilus_trader.backtest.engine import BacktestEngine
from nautilus_trader.model.currencies import USDT
from nautilus_trader.model.data import BarType
from nautilus_trader.model.enums import AccountType
from nautilus_trader.model.enums import AggressorSide
from nautilus_trader.model.enums import OmsType
from nautilus_trader.model.identifiers import TraderId
from nautilus_trader.model.identifiers import Venue
from nautilus_trader.model.objects import Money
from nautilus_trader.persistence.wranglers import TradeTickDataWrangler
from nautilus_trader.test_kit.providers import TestDataProvider
from nautilus_trader.test_kit.providers import TestInstrumentProvider

from terminal.server.bar_streaming_actor import BarStreamingActor
from terminal.server.bar_streaming_actor import BarStreamingActorConfig


def create_backtest_queue(
    loop: asyncio.AbstractEventLoop,
    delay_ms: int = 50,
    dataset: str = "ethusdt",
) -> tuple[BacktestEngine, asyncio.Queue]:
    """
    Create a BacktestEngine configured to stream 1-minute Binance trade tick bars to a queue.

    Loads Binance trade tick data (ETHUSDT or BTCUSDT) using TradeTickDataWrangler,
    validates both AggressorSide.BUYER and SELLER are present, and creates LAST-INTERNAL
    bars from trade volume aggregation.

    Parameters
    ----------
    loop : asyncio.AbstractEventLoop
        The main event loop for thread-safe queue bridging.
    delay_ms : int, default 50
        Playback delay in milliseconds after each bar emission.
    dataset : str, default "ethusdt"
        Dataset to load: "ethusdt" (69,806 trades CSV) or "btcusdt" (2,001 trades parquet).

    Returns
    -------
    tuple[BacktestEngine, asyncio.Queue]
        The configured engine (ready to run) and the queue receiving bar envelopes.

    Raises
    ------
    ValueError
        If dataset is invalid or if both aggressor sides are not present in data.

    Notes
    -----
    - Dataset ETHUSDT: tests/test_data/binance/ethusdt-trades.csv (69,806 trades)
    - Dataset BTCUSDT: tests/test_data/binance/btcusdt-trades.parquet (2,001 trades)
    - BTCUSDT parquet buyer_maker column is coerced from strings to bool
    - BarType: <SYMBOL>.BINANCE-1-MINUTE-LAST-INTERNAL (LAST price, INTERNAL aggregation)
    - Actor subscribes to trade ticks AND bars, forwarding to queue via call_soon_threadsafe
    - The engine is NOT started; caller must run engine.run() on a background thread

    """
    # Validate dataset parameter
    if dataset not in ("ethusdt", "btcusdt"):
        msg = f"Invalid dataset '{dataset}', must be 'ethusdt' or 'btcusdt'"
        raise ValueError(msg)

    # Configure backtest engine
    config = BacktestEngineConfig(
        trader_id=TraderId("BACKTESTER-001"),
    )
    engine = BacktestEngine(config=config)

    # Add trading venue (BINANCE venue for crypto)
    BINANCE = Venue("BINANCE")
    engine.add_venue(
        venue=BINANCE,
        oms_type=OmsType.NETTING,
        account_type=AccountType.CASH,
        base_currency=None,  # Multi-currency account
        starting_balances=[Money(1_000_000, USDT)],
    )

    # Add instrument based on dataset
    if dataset == "ethusdt":
        instrument = TestInstrumentProvider.ethusdt_binance()
        data_path = "binance/ethusdt-trades.csv"
        read_func = "read_csv_ticks"
    else:  # btcusdt
        instrument = TestInstrumentProvider.btcusdt_binance()
        data_path = "binance/btcusdt-trades.parquet"
        read_func = "read_parquet_ticks"

    engine.add_instrument(instrument)

    # Add trade tick data
    provider = TestDataProvider()

    # For BTCUSDT parquet, coerce buyer_maker from strings to bool
    if dataset == "btcusdt":
        # Read parquet directly to coerce buyer_maker
        raw_data = getattr(provider, read_func)(data_path)

        # Coerce buyer_maker column from strings 'True'/'False' to Python bool
        if hasattr(raw_data, "buyer_maker"):
            # If raw_data is a DataFrame
            if isinstance(raw_data["buyer_maker"].iloc[0], str):
                raw_data["buyer_maker"] = raw_data["buyer_maker"].map(
                    {"True": True, "False": False}
                )

        wrangler = TradeTickDataWrangler(instrument=instrument)
        ticks = wrangler.process(raw_data)
    else:
        # ETHUSDT CSV - direct processing
        wrangler = TradeTickDataWrangler(instrument=instrument)
        raw_data = getattr(provider, read_func)(data_path)
        ticks = wrangler.process(raw_data)

    # Validate both aggressor sides are present
    aggressor_sides = {tick.aggressor_side for tick in ticks}
    if not {AggressorSide.BUYER, AggressorSide.SELLER}.issubset(aggressor_sides):
        buyer_count = sum(1 for tick in ticks if tick.aggressor_side == AggressorSide.BUYER)
        seller_count = sum(1 for tick in ticks if tick.aggressor_side == AggressorSide.SELLER)
        msg = (
            f"Dataset '{dataset}' missing aggressor sides. "
            f"BUYER count: {buyer_count}, SELLER count: {seller_count}. "
            f"Both sides required."
        )
        raise ValueError(msg)

    engine.add_data(ticks)

    # Create actor and queue
    queue = asyncio.Queue()
    actor_config = BarStreamingActorConfig(delay_ms=delay_ms)
    actor = BarStreamingActor(config=actor_config)
    actor.set_queue(queue, loop)

    # Register actor with engine
    engine.add_actor(actor)

    # Subscribe actor to trade ticks
    actor.subscribe_trade_ticks(instrument.id)

    # Subscribe actor to 1-minute bars with LAST-INTERNAL aggregation
    symbol = instrument.id.symbol.value
    bar_type = BarType.from_str(f"{symbol}.BINANCE-1-MINUTE-LAST-INTERNAL")
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
