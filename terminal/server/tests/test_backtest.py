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
import sys
from unittest.mock import AsyncMock
from unittest.mock import MagicMock
from unittest.mock import Mock
from unittest.mock import patch

import pytest

# Add parent directory to path to allow imports
sys.path.insert(0, "/Users/robinbeck/Projects/nautilus/nautilus_trader_stellarsquall/.worktrees/issue-7732fe1e-10-backend-backtest-functions")

# Check for dependencies
try:
    import msgspec  # noqa: F401
    DEPENDENCIES_AVAILABLE = True
except ImportError:
    DEPENDENCIES_AVAILABLE = False

if not DEPENDENCIES_AVAILABLE:
    pytest.skip("Required dependencies not available (msgspec)", allow_module_level=True)

# Mock NautilusTrader modules before importing our code
sys.modules["nautilus_trader"] = MagicMock()
sys.modules["nautilus_trader.backtest"] = MagicMock()
sys.modules["nautilus_trader.backtest.config"] = MagicMock()
sys.modules["nautilus_trader.backtest.engine"] = MagicMock()
sys.modules["nautilus_trader.model"] = MagicMock()
sys.modules["nautilus_trader.model.currencies"] = MagicMock()
sys.modules["nautilus_trader.model.data"] = MagicMock()
sys.modules["nautilus_trader.model.enums"] = MagicMock()
sys.modules["nautilus_trader.model.identifiers"] = MagicMock()
sys.modules["nautilus_trader.model.objects"] = MagicMock()
sys.modules["nautilus_trader.persistence"] = MagicMock()
sys.modules["nautilus_trader.persistence.wranglers"] = MagicMock()
sys.modules["nautilus_trader.test_kit"] = MagicMock()
sys.modules["nautilus_trader.test_kit.providers"] = MagicMock()
sys.modules["nautilus_trader.common"] = MagicMock()
sys.modules["nautilus_trader.common.actor"] = MagicMock()
sys.modules["nautilus_trader.config"] = MagicMock()

# Mock the Actor base class
class MockActorBase:
    """Mock base Actor class."""
    def __init__(self, config=None):
        self.log = MagicMock()

# Mock ActorConfig base class as msgspec.Struct
import msgspec
class MockActorConfigBase(msgspec.Struct, kw_only=True, frozen=True):
    """Mock base ActorConfig class."""
    pass

sys.modules["nautilus_trader.common.actor"].Actor = MockActorBase
sys.modules["nautilus_trader.config"].ActorConfig = MockActorConfigBase

from terminal.server.backtest import create_backtest_queue
from terminal.server.backtest import run_backtest_with_delay


@pytest.fixture
def mock_event_loop():
    """Create a mock asyncio event loop."""
    loop = Mock(spec=asyncio.AbstractEventLoop)
    loop.run_in_executor = AsyncMock()
    return loop


@pytest.fixture
def mock_backtest_engine():
    """Create a mock BacktestEngine."""
    engine = MagicMock()
    engine.run = Mock()
    engine.add_venue = Mock()
    engine.add_instrument = Mock()
    engine.add_data = Mock()
    engine.add_actor = Mock()
    return engine


@pytest.fixture
def mock_queue():
    """Create a mock asyncio.Queue."""
    queue = AsyncMock(spec=asyncio.Queue)
    queue.put = AsyncMock()
    return queue


class TestCreateBacktestQueue:
    """Unit tests for create_backtest_queue function."""

    @patch("terminal.server.backtest.BacktestEngine")
    @patch("terminal.server.backtest.TestInstrumentProvider")
    @patch("terminal.server.backtest.TestDataProvider")
    @patch("terminal.server.backtest.QuoteTickDataWrangler")
    @patch("terminal.server.backtest.BarStreamingActor")
    @patch("terminal.server.backtest.asyncio.Queue")
    def test_returns_engine_and_queue(
        self,
        mock_queue_class,
        mock_actor_class,
        mock_wrangler_class,
        mock_data_provider_class,
        mock_instrument_provider_class,
        mock_engine_class,
        mock_event_loop,
    ):
        """Test that create_backtest_queue returns BacktestEngine and asyncio.Queue."""
        # Setup mocks
        mock_engine = MagicMock()
        mock_engine_class.return_value = mock_engine

        mock_queue = MagicMock()
        mock_queue_class.return_value = mock_queue

        mock_actor = MagicMock()
        mock_actor_class.return_value = mock_actor

        mock_instrument = MagicMock()
        mock_instrument_provider_class.default_fx_ccy.return_value = mock_instrument

        mock_provider = MagicMock()
        mock_data_provider_class.return_value = mock_provider

        mock_wrangler = MagicMock()
        mock_wrangler.process.return_value = []
        mock_wrangler_class.return_value = mock_wrangler

        # Call function
        engine, queue = create_backtest_queue(mock_event_loop, delay_ms=50)

        # Assert return types
        assert engine is mock_engine
        assert queue is mock_queue

    @patch("terminal.server.backtest.BacktestEngine")
    @patch("terminal.server.backtest.TestInstrumentProvider")
    @patch("terminal.server.backtest.TestDataProvider")
    @patch("terminal.server.backtest.QuoteTickDataWrangler")
    @patch("terminal.server.backtest.BarStreamingActor")
    @patch("terminal.server.backtest.asyncio.Queue")
    def test_creates_engine_with_correct_trader_id(
        self,
        mock_queue_class,
        mock_actor_class,
        mock_wrangler_class,
        mock_data_provider_class,
        mock_instrument_provider_class,
        mock_engine_class,
        mock_event_loop,
    ):
        """Test that BacktestEngine is created with TraderId('BACKTESTER-001')."""
        # Setup mocks
        mock_engine = MagicMock()
        mock_engine_class.return_value = mock_engine

        mock_queue = MagicMock()
        mock_queue_class.return_value = mock_queue

        mock_actor = MagicMock()
        mock_actor_class.return_value = mock_actor

        mock_instrument = MagicMock()
        mock_instrument_provider_class.default_fx_ccy.return_value = mock_instrument

        mock_provider = MagicMock()
        mock_data_provider_class.return_value = mock_provider

        mock_wrangler = MagicMock()
        mock_wrangler.process.return_value = []
        mock_wrangler_class.return_value = mock_wrangler

        # Call function
        create_backtest_queue(mock_event_loop, delay_ms=50)

        # Assert BacktestEngine was created with config parameter
        mock_engine_class.assert_called_once()
        call_args = mock_engine_class.call_args
        assert "config" in call_args.kwargs
        # Config is mocked, so just verify it was passed

    @patch("terminal.server.backtest.BacktestEngine")
    @patch("terminal.server.backtest.TestInstrumentProvider")
    @patch("terminal.server.backtest.TestDataProvider")
    @patch("terminal.server.backtest.QuoteTickDataWrangler")
    @patch("terminal.server.backtest.BarStreamingActor")
    @patch("terminal.server.backtest.asyncio.Queue")
    def test_adds_sim_venue_with_correct_config(
        self,
        mock_queue_class,
        mock_actor_class,
        mock_wrangler_class,
        mock_data_provider_class,
        mock_instrument_provider_class,
        mock_engine_class,
        mock_event_loop,
    ):
        """Test that SIM venue is added with OmsType.HEDGING, AccountType.MARGIN, USD base."""
        # Setup mocks
        mock_engine = MagicMock()
        mock_engine_class.return_value = mock_engine

        mock_queue = MagicMock()
        mock_queue_class.return_value = mock_queue

        mock_actor = MagicMock()
        mock_actor_class.return_value = mock_actor

        mock_instrument = MagicMock()
        mock_instrument_provider_class.default_fx_ccy.return_value = mock_instrument

        mock_provider = MagicMock()
        mock_data_provider_class.return_value = mock_provider

        mock_wrangler = MagicMock()
        mock_wrangler.process.return_value = []
        mock_wrangler_class.return_value = mock_wrangler

        # Call function
        create_backtest_queue(mock_event_loop, delay_ms=50)

        # Assert add_venue was called with required parameters
        mock_engine.add_venue.assert_called_once()
        call_kwargs = mock_engine.add_venue.call_args.kwargs

        # Verify all required parameters are present
        assert "venue" in call_kwargs
        assert "oms_type" in call_kwargs
        assert "account_type" in call_kwargs
        assert "base_currency" in call_kwargs
        assert "starting_balances" in call_kwargs
        assert len(call_kwargs["starting_balances"]) == 1

    @patch("terminal.server.backtest.BacktestEngine")
    @patch("terminal.server.backtest.TestInstrumentProvider")
    @patch("terminal.server.backtest.TestDataProvider")
    @patch("terminal.server.backtest.QuoteTickDataWrangler")
    @patch("terminal.server.backtest.BarStreamingActor")
    @patch("terminal.server.backtest.asyncio.Queue")
    def test_adds_audusd_instrument(
        self,
        mock_queue_class,
        mock_actor_class,
        mock_wrangler_class,
        mock_data_provider_class,
        mock_instrument_provider_class,
        mock_engine_class,
        mock_event_loop,
    ):
        """Test that AUD/USD instrument is added via TestInstrumentProvider."""
        # Setup mocks
        mock_engine = MagicMock()
        mock_engine_class.return_value = mock_engine

        mock_queue = MagicMock()
        mock_queue_class.return_value = mock_queue

        mock_actor = MagicMock()
        mock_actor_class.return_value = mock_actor

        mock_instrument = MagicMock()
        mock_instrument_provider_class.default_fx_ccy.return_value = mock_instrument

        mock_provider = MagicMock()
        mock_data_provider_class.return_value = mock_provider

        mock_wrangler = MagicMock()
        mock_wrangler.process.return_value = []
        mock_wrangler_class.return_value = mock_wrangler

        # Call function
        create_backtest_queue(mock_event_loop, delay_ms=50)

        # Assert instrument provider was called with AUD/USD
        mock_instrument_provider_class.default_fx_ccy.assert_called_once()
        call_args = mock_instrument_provider_class.default_fx_ccy.call_args
        assert call_args[0][0] == "AUD/USD"
        # Second arg is SIM venue (mocked)

        # Assert instrument was added to engine
        mock_engine.add_instrument.assert_called_once_with(mock_instrument)

    @patch("terminal.server.backtest.BacktestEngine")
    @patch("terminal.server.backtest.TestInstrumentProvider")
    @patch("terminal.server.backtest.TestDataProvider")
    @patch("terminal.server.backtest.QuoteTickDataWrangler")
    @patch("terminal.server.backtest.BarStreamingActor")
    @patch("terminal.server.backtest.asyncio.Queue")
    def test_loads_quote_ticks_from_csv(
        self,
        mock_queue_class,
        mock_actor_class,
        mock_wrangler_class,
        mock_data_provider_class,
        mock_instrument_provider_class,
        mock_engine_class,
        mock_event_loop,
    ):
        """Test that quote ticks are loaded from truefx/audusd-ticks.csv."""
        # Setup mocks
        mock_engine = MagicMock()
        mock_engine_class.return_value = mock_engine

        mock_queue = MagicMock()
        mock_queue_class.return_value = mock_queue

        mock_actor = MagicMock()
        mock_actor_class.return_value = mock_actor

        mock_instrument = MagicMock()
        mock_instrument_provider_class.default_fx_ccy.return_value = mock_instrument

        mock_provider = MagicMock()
        mock_csv_data = MagicMock()
        mock_provider.read_csv_ticks.return_value = mock_csv_data
        mock_data_provider_class.return_value = mock_provider

        mock_ticks = [MagicMock(), MagicMock()]
        mock_wrangler = MagicMock()
        mock_wrangler.process.return_value = mock_ticks
        mock_wrangler_class.return_value = mock_wrangler

        # Call function
        create_backtest_queue(mock_event_loop, delay_ms=50)

        # Assert data provider reads correct CSV
        mock_provider.read_csv_ticks.assert_called_once_with("truefx/audusd-ticks.csv")

        # Assert wrangler processes the data
        mock_wrangler.process.assert_called_once_with(mock_csv_data)

        # Assert processed ticks are added to engine
        mock_engine.add_data.assert_called_once_with(mock_ticks)

    @patch("terminal.server.backtest.BacktestEngine")
    @patch("terminal.server.backtest.TestInstrumentProvider")
    @patch("terminal.server.backtest.TestDataProvider")
    @patch("terminal.server.backtest.QuoteTickDataWrangler")
    @patch("terminal.server.backtest.BarStreamingActor")
    @patch("terminal.server.backtest.asyncio.Queue")
    def test_creates_actor_and_injects_queue(
        self,
        mock_queue_class,
        mock_actor_class,
        mock_wrangler_class,
        mock_data_provider_class,
        mock_instrument_provider_class,
        mock_engine_class,
        mock_event_loop,
    ):
        """Test that BarStreamingActor is created and queue is injected."""
        # Setup mocks
        mock_engine = MagicMock()
        mock_engine_class.return_value = mock_engine

        mock_queue = MagicMock()
        mock_queue_class.return_value = mock_queue

        mock_actor = MagicMock()
        mock_actor_class.return_value = mock_actor

        mock_instrument = MagicMock()
        mock_instrument_provider_class.default_fx_ccy.return_value = mock_instrument

        mock_provider = MagicMock()
        mock_data_provider_class.return_value = mock_provider

        mock_wrangler = MagicMock()
        mock_wrangler.process.return_value = []
        mock_wrangler_class.return_value = mock_wrangler

        # Call function
        create_backtest_queue(mock_event_loop, delay_ms=100)

        # Assert actor was created with correct config
        mock_actor_class.assert_called_once()
        config = mock_actor_class.call_args.kwargs["config"]
        assert config.delay_ms == 100

        # Assert queue was injected into actor
        mock_actor.set_queue.assert_called_once_with(mock_queue, mock_event_loop)

    @patch("terminal.server.backtest.BacktestEngine")
    @patch("terminal.server.backtest.TestInstrumentProvider")
    @patch("terminal.server.backtest.TestDataProvider")
    @patch("terminal.server.backtest.QuoteTickDataWrangler")
    @patch("terminal.server.backtest.BarStreamingActor")
    @patch("terminal.server.backtest.asyncio.Queue")
    def test_actor_added_to_engine(
        self,
        mock_queue_class,
        mock_actor_class,
        mock_wrangler_class,
        mock_data_provider_class,
        mock_instrument_provider_class,
        mock_engine_class,
        mock_event_loop,
    ):
        """Test that actor is added to the engine."""
        # Setup mocks
        mock_engine = MagicMock()
        mock_engine_class.return_value = mock_engine

        mock_queue = MagicMock()
        mock_queue_class.return_value = mock_queue

        mock_actor = MagicMock()
        mock_actor_class.return_value = mock_actor

        mock_instrument = MagicMock()
        mock_instrument_provider_class.default_fx_ccy.return_value = mock_instrument

        mock_provider = MagicMock()
        mock_data_provider_class.return_value = mock_provider

        mock_wrangler = MagicMock()
        mock_wrangler.process.return_value = []
        mock_wrangler_class.return_value = mock_wrangler

        # Call function
        create_backtest_queue(mock_event_loop, delay_ms=50)

        # Assert actor was added to engine
        mock_engine.add_actor.assert_called_once_with(mock_actor)

    @patch("terminal.server.backtest.BacktestEngine")
    @patch("terminal.server.backtest.TestInstrumentProvider")
    @patch("terminal.server.backtest.TestDataProvider")
    @patch("terminal.server.backtest.QuoteTickDataWrangler")
    @patch("terminal.server.backtest.BarStreamingActor")
    @patch("terminal.server.backtest.asyncio.Queue")
    @patch("terminal.server.backtest.BarType")
    def test_subscribes_to_correct_bar_type(
        self,
        mock_bar_type_class,
        mock_queue_class,
        mock_actor_class,
        mock_wrangler_class,
        mock_data_provider_class,
        mock_instrument_provider_class,
        mock_engine_class,
        mock_event_loop,
    ):
        """Test that actor subscribes to AUD/USD.SIM-1-MINUTE-MID-INTERNAL bars."""
        # Setup mocks
        mock_engine = MagicMock()
        mock_engine_class.return_value = mock_engine

        mock_queue = MagicMock()
        mock_queue_class.return_value = mock_queue

        mock_actor = MagicMock()
        mock_actor_class.return_value = mock_actor

        mock_instrument = MagicMock()
        mock_instrument_provider_class.default_fx_ccy.return_value = mock_instrument

        mock_provider = MagicMock()
        mock_data_provider_class.return_value = mock_provider

        mock_wrangler = MagicMock()
        mock_wrangler.process.return_value = []
        mock_wrangler_class.return_value = mock_wrangler

        mock_bar_type = MagicMock()
        mock_bar_type_class.from_str.return_value = mock_bar_type

        # Call function
        create_backtest_queue(mock_event_loop, delay_ms=50)

        # Assert BarType.from_str was called with INTERNAL aggregation
        mock_bar_type_class.from_str.assert_called_once_with(
            "AUD/USD.SIM-1-MINUTE-MID-INTERNAL",
        )

        # Assert actor subscribed to the bar type
        mock_actor.subscribe_bars.assert_called_once_with(mock_bar_type)


class TestRunBacktestWithDelay:
    """Unit tests for run_backtest_with_delay function."""

    @pytest.mark.asyncio
    async def test_runs_engine_in_executor(self, mock_backtest_engine):
        """Test that engine.run() is called via loop.run_in_executor."""
        # Create a real queue for this test
        queue = asyncio.Queue()

        # Mock the event loop to capture run_in_executor call
        with patch("terminal.server.backtest.asyncio.get_running_loop") as mock_get_loop:
            mock_loop = AsyncMock()
            mock_get_loop.return_value = mock_loop

            # Make run_in_executor return None immediately
            mock_loop.run_in_executor = AsyncMock(return_value=None)

            # Run the function
            await run_backtest_with_delay(mock_backtest_engine, queue, delay_ms=50)

            # Assert run_in_executor was called with correct arguments
            mock_loop.run_in_executor.assert_called_once_with(
                None,
                mock_backtest_engine.run,
            )

    @pytest.mark.asyncio
    async def test_enqueues_none_after_completion(self, mock_backtest_engine):
        """Test that None is enqueued after engine.run() completes (EOF signal)."""
        # Create a real queue for this test
        queue = asyncio.Queue()

        # Mock the event loop
        with patch("terminal.server.backtest.asyncio.get_running_loop") as mock_get_loop:
            mock_loop = AsyncMock()
            mock_get_loop.return_value = mock_loop

            # Make run_in_executor return None immediately
            mock_loop.run_in_executor = AsyncMock(return_value=None)

            # Run the function
            await run_backtest_with_delay(mock_backtest_engine, queue, delay_ms=50)

            # Assert None was enqueued
            item = await asyncio.wait_for(queue.get(), timeout=1.0)
            assert item is None

    @pytest.mark.asyncio
    async def test_engine_run_is_called(self, mock_backtest_engine):
        """Test that engine.run() is actually called."""
        # Create a real queue for this test
        queue = asyncio.Queue()

        # Mock the event loop
        with patch("terminal.server.backtest.asyncio.get_running_loop") as mock_get_loop:
            mock_loop = AsyncMock()
            mock_get_loop.return_value = mock_loop

            # Make run_in_executor actually call the function
            def executor_side_effect(executor, func):
                func()  # Call the function synchronously for testing
                return asyncio.Future()

            mock_loop.run_in_executor = AsyncMock(side_effect=lambda e, f: (f(), None)[1])

            # Run the function
            await run_backtest_with_delay(mock_backtest_engine, queue, delay_ms=50)

            # Assert engine.run() was called
            mock_backtest_engine.run.assert_called_once()
