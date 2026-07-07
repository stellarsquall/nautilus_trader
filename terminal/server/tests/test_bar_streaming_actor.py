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
from unittest.mock import MagicMock
from unittest.mock import Mock

import pytest

# Check for dependencies
try:
    import msgspec  # noqa: F401
    DEPENDENCIES_AVAILABLE = True
except ImportError:
    DEPENDENCIES_AVAILABLE = False

if not DEPENDENCIES_AVAILABLE:
    pytest.skip("Required dependencies not available (msgspec)", allow_module_level=True)

# Mock NautilusTrader modules before importing our actor.
#
# Import-order independence: another test file (e.g. test_backtest.py) may have
# already imported the REAL nautilus_trader and cached bar_streaming_actor bound
# to the real Cython Actor (whose .log is a read-only property, so the
# `actor.log = MagicMock()` lines below would raise AttributeError). We therefore
# (1) save whatever is currently in sys.modules for the names we shadow, (2)
# install the mocks, (3) force a fresh import of bar_streaming_actor under the
# mocks, and (4) restore the originals in teardown_module so these mocks never
# leak into other test files.
_SHADOWED_MODULE_NAMES = (
    "nautilus_trader",
    "nautilus_trader.common",
    "nautilus_trader.common.actor",
    "nautilus_trader.config",
    "nautilus_trader.model",
    "nautilus_trader.model.data",
    "terminal.server.bar_streaming_actor",
)
_SAVED_MODULES = {name: sys.modules.get(name) for name in _SHADOWED_MODULE_NAMES}

sys.modules["nautilus_trader"] = MagicMock()
sys.modules["nautilus_trader.common"] = MagicMock()
sys.modules["nautilus_trader.common.actor"] = MagicMock()
sys.modules["nautilus_trader.config"] = MagicMock()
sys.modules["nautilus_trader.model"] = MagicMock()
sys.modules["nautilus_trader.model.data"] = MagicMock()

# Create mock Actor base class
class MockActorBase:
    """Mock base Actor class."""
    def __init__(self, config=None):
        self.log = MagicMock()

# Create mock ActorConfig base class as msgspec.Struct
import msgspec
class MockActorConfigBase(msgspec.Struct, kw_only=True, frozen=True):
    """Mock base ActorConfig class."""
    pass

sys.modules["nautilus_trader.common.actor"].Actor = MockActorBase
sys.modules["nautilus_trader.config"].ActorConfig = MockActorConfigBase

# Force a fresh import under the mocked base, even if another test file already
# imported bar_streaming_actor against the real nautilus_trader.
sys.modules.pop("terminal.server.bar_streaming_actor", None)

from terminal.server.bar_streaming_actor import BarStreamingActor
from terminal.server.bar_streaming_actor import BarStreamingActorConfig


def teardown_module(module):  # noqa: ARG001
    """Restore sys.modules so the NautilusTrader mocks don't leak to other files.

    Without this, the MagicMock nautilus_trader modules (and the mock-based
    bar_streaming_actor) would remain in sys.modules and could shadow the real
    ones for any test file that imports them after this one.
    """
    for name, original in _SAVED_MODULES.items():
        if original is None:
            sys.modules.pop(name, None)
        else:
            sys.modules[name] = original


# Mock Bar class for testing (mimics nautilus_trader.model.data.Bar structure)
class MockBar:
    """Mock Bar object for testing without requiring full NautilusTrader build."""

    def __init__(
        self,
        ts_event: int,
        open_price: float,
        high: float,
        low: float,
        close: float,
        volume: float,
    ):
        self.ts_event = ts_event
        self.open = open_price
        self.high = high
        self.low = low
        self.close = close
        self.volume = volume


@pytest.fixture
def mock_queue():
    """Create a mock asyncio.Queue for testing."""
    queue = Mock(spec=asyncio.Queue)
    queue.put_nowait = Mock()
    return queue


@pytest.fixture
def mock_loop():
    """Create a mock event loop for testing."""
    loop = Mock(spec=asyncio.AbstractEventLoop)
    loop.call_soon_threadsafe = Mock()
    return loop


@pytest.fixture
def actor_config():
    """Create a BarStreamingActorConfig with default values."""
    return BarStreamingActorConfig()


@pytest.fixture
def actor(actor_config):
    """Create a BarStreamingActor instance."""
    return BarStreamingActor(config=actor_config)


def test_actor_config_defaults():
    """Test that BarStreamingActorConfig has correct default values."""
    config = BarStreamingActorConfig()
    assert config.component_id == "BAR_STREAMER"
    assert config.delay_ms == 50


def test_actor_config_custom_values():
    """Test that BarStreamingActorConfig accepts custom values."""
    config = BarStreamingActorConfig(component_id="CUSTOM_STREAMER", delay_ms=100)
    assert config.component_id == "CUSTOM_STREAMER"
    assert config.delay_ms == 100


def test_actor_initialization(actor):
    """Test that BarStreamingActor initializes with correct state."""
    assert actor._queue is None
    assert actor._loop is None
    assert actor._seq == 0
    assert actor._delay_seconds == 0.05  # 50ms / 1000


def test_set_queue(actor, mock_queue, mock_loop):
    """Test that set_queue correctly injects dependencies."""
    actor.set_queue(mock_queue, mock_loop)
    assert actor._queue is mock_queue
    assert actor._loop is mock_loop


def test_on_bar_without_queue_injection(actor):
    """Test that on_bar handles missing queue injection gracefully."""
    # Mock the log attribute to verify error logging
    actor.log = MagicMock()

    bar = MockBar(
        ts_event=1580395680000000000,  # nanoseconds
        open_price=0.6700,
        high=0.6705,
        low=0.6698,
        close=0.6702,
        volume=100000,
    )

    actor.on_bar(bar)

    # Verify error was logged
    actor.log.error.assert_called_once_with("Queue not injected, cannot stream bars")


def test_envelope_structure(actor, mock_queue, mock_loop):
    """Test that on_bar creates envelopes with correct structure."""
    actor.set_queue(mock_queue, mock_loop)
    actor.log = MagicMock()  # Mock log to avoid errors

    bar = MockBar(
        ts_event=1580395680000000000,  # nanoseconds (2020-01-30 12:28:00)
        open_price=0.6700,
        high=0.6705,
        low=0.6698,
        close=0.6702,
        volume=100000,
    )

    actor.on_bar(bar)

    # Verify call_soon_threadsafe was called once
    assert mock_loop.call_soon_threadsafe.call_count == 1

    # Extract the envelope that was enqueued
    call_args = mock_loop.call_soon_threadsafe.call_args
    assert call_args[0][0] == mock_queue.put_nowait
    envelope = call_args[0][1]

    # Verify envelope structure matches protocol
    assert envelope["v"] == 1
    assert envelope["type"] == "bar"
    assert envelope["seq"] == 1
    assert "payload" in envelope

    payload = envelope["payload"]
    assert "ts_event" in payload
    assert "open" in payload
    assert "high" in payload
    assert "low" in payload
    assert "close" in payload
    assert "volume" in payload

    # Verify timestamp conversion (nanoseconds → milliseconds)
    assert payload["ts_event"] == 1580395680000  # 1580395680000000000 // 1_000_000
    assert payload["open"] == 0.6700
    assert payload["high"] == 0.6705
    assert payload["low"] == 0.6698
    assert payload["close"] == 0.6702
    assert payload["volume"] == 100000


def test_sequence_monotonicity(actor, mock_queue, mock_loop):
    """Test that sequence numbers are monotonic across multiple on_bar calls."""
    actor.set_queue(mock_queue, mock_loop)
    actor.log = MagicMock()

    # Create 10 mock bars and call on_bar for each
    for i in range(10):
        bar = MockBar(
            ts_event=1580395680000000000 + (i * 60_000_000_000),  # 1 minute apart
            open_price=0.6700 + (i * 0.0001),
            high=0.6705 + (i * 0.0001),
            low=0.6698 + (i * 0.0001),
            close=0.6702 + (i * 0.0001),
            volume=100000 + (i * 1000),
        )
        actor.on_bar(bar)

    # Verify call_soon_threadsafe was called 10 times
    assert mock_loop.call_soon_threadsafe.call_count == 10

    # Extract all sequence numbers
    seq_numbers = []
    for call in mock_loop.call_soon_threadsafe.call_args_list:
        envelope = call[0][1]
        seq_numbers.append(envelope["seq"])

    # Verify sequence numbers are monotonic [1, 2, 3, ..., 10]
    assert seq_numbers == list(range(1, 11))

    # Verify no duplicates
    assert len(set(seq_numbers)) == len(seq_numbers)


def test_timestamp_conversion(actor, mock_queue, mock_loop):
    """Test that timestamp conversion from nanoseconds to milliseconds is correct."""
    actor.set_queue(mock_queue, mock_loop)
    actor.log = MagicMock()

    # Test various timestamp values
    test_cases = [
        (1580395680000000000, 1580395680000),  # 2020-01-30 12:28:00
        (1580395740123456789, 1580395740123),  # with sub-millisecond precision
        (1000000000000000000, 1000000000000),  # round billion nanoseconds
        (1580395680999999999, 1580395680999),  # near millisecond boundary
    ]

    for ns_timestamp, expected_ms in test_cases:
        bar = MockBar(
            ts_event=ns_timestamp,
            open_price=0.6700,
            high=0.6705,
            low=0.6698,
            close=0.6702,
            volume=100000,
        )

        actor.on_bar(bar)

        # Extract the last envelope
        call_args = mock_loop.call_soon_threadsafe.call_args
        envelope = call_args[0][1]

        # Verify timestamp conversion
        assert envelope["payload"]["ts_event"] == expected_ms


def test_thread_safe_enqueue_pattern(actor, mock_queue, mock_loop):
    """Test that enqueue uses call_soon_threadsafe for thread safety."""
    actor.set_queue(mock_queue, mock_loop)
    actor.log = MagicMock()

    bar = MockBar(
        ts_event=1580395680000000000,
        open_price=0.6700,
        high=0.6705,
        low=0.6698,
        close=0.6702,
        volume=100000,
    )

    actor.on_bar(bar)

    # Verify call_soon_threadsafe was used (not direct queue.put_nowait)
    mock_loop.call_soon_threadsafe.assert_called_once()

    # Verify the callable is queue.put_nowait
    call_args = mock_loop.call_soon_threadsafe.call_args
    assert call_args[0][0] == mock_queue.put_nowait

    # Verify queue.put_nowait was NOT called directly
    mock_queue.put_nowait.assert_not_called()


def test_payload_types(actor, mock_queue, mock_loop):
    """Test that payload values are properly converted to float."""
    actor.set_queue(mock_queue, mock_loop)
    actor.log = MagicMock()

    bar = MockBar(
        ts_event=1580395680000000000,
        open_price=0.6700,
        high=0.6705,
        low=0.6698,
        close=0.6702,
        volume=100000,
    )

    actor.on_bar(bar)

    call_args = mock_loop.call_soon_threadsafe.call_args
    envelope = call_args[0][1]
    payload = envelope["payload"]

    # Verify all price/volume values are float
    assert isinstance(payload["open"], float)
    assert isinstance(payload["high"], float)
    assert isinstance(payload["low"], float)
    assert isinstance(payload["close"], float)
    assert isinstance(payload["volume"], float)

    # Verify ts_event is int (milliseconds)
    assert isinstance(payload["ts_event"], int)


def test_delay_configuration(actor_config):
    """Test that delay_ms is correctly converted to seconds."""
    config_50ms = BarStreamingActorConfig(delay_ms=50)
    actor_50ms = BarStreamingActor(config=config_50ms)
    assert actor_50ms._delay_seconds == 0.05

    config_100ms = BarStreamingActorConfig(delay_ms=100)
    actor_100ms = BarStreamingActor(config=config_100ms)
    assert actor_100ms._delay_seconds == 0.1

    config_0ms = BarStreamingActorConfig(delay_ms=0)
    actor_0ms = BarStreamingActor(config=config_0ms)
    assert actor_0ms._delay_seconds == 0.0
