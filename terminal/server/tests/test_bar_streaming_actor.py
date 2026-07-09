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
    "nautilus_trader.model.enums",
    "terminal.server.bar_streaming_actor",
)
_SAVED_MODULES = {name: sys.modules.get(name) for name in _SHADOWED_MODULE_NAMES}

sys.modules["nautilus_trader"] = MagicMock()
sys.modules["nautilus_trader.common"] = MagicMock()
sys.modules["nautilus_trader.common.actor"] = MagicMock()
sys.modules["nautilus_trader.config"] = MagicMock()
sys.modules["nautilus_trader.model"] = MagicMock()
sys.modules["nautilus_trader.model.data"] = MagicMock()
sys.modules["nautilus_trader.model.enums"] = MagicMock()

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

# The mocked enums module yields stable sentinel objects for BUYER/SELLER
# (MagicMock caches attribute access), so equality checks in the actor work.
from nautilus_trader.model.enums import AggressorSide


def _restore_shadowed_modules() -> None:
    """Put the real (or absent) nautilus_trader modules back into sys.modules.

    CRITICAL: pytest imports every test module during the COLLECTION phase before
    running any test. The MagicMock shadows installed above must therefore be
    removed at MODULE IMPORT time (here), not merely in teardown_module (a
    run-phase hook) — otherwise sibling modules collected after this one bind
    their import-time `from nautilus_trader... import X` against the mocks,
    corrupting real BarType/enum parsing (e.g. "Aggregation type not supported
    for time bars, was MINUTE"). We have already captured the mock-bound
    BarStreamingActor and AggressorSide sentinel above, so restoring the real
    modules now is safe.
    """
    for name, original in _SAVED_MODULES.items():
        if original is None:
            sys.modules.pop(name, None)
        else:
            sys.modules[name] = original


_restore_shadowed_modules()


def teardown_module(module):  # noqa: ARG001
    """Belt-and-suspenders restore (import-time _restore_shadowed_modules already
    ran; this re-restores in case a test re-installed a shadow).
    """
    _restore_shadowed_modules()


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


class MockTradeTick:
    """Mock TradeTick object (mimics nautilus_trader.model.data.TradeTick)."""

    def __init__(self, ts_event: int, size: float, aggressor_side) -> None:
        self.ts_event = ts_event
        self.size = size
        self.aggressor_side = aggressor_side


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
    assert actor._buckets == {}
    assert actor._cvd == 0.0


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
    """Test that on_bar creates a bar envelope with correct structure."""
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

    # Dual-envelope emission: one bar envelope followed by one cvd envelope.
    assert mock_loop.call_soon_threadsafe.call_count == 2

    # The bar envelope is the FIRST enqueue.
    bar_call = mock_loop.call_soon_threadsafe.call_args_list[0]
    assert bar_call[0][0] == mock_queue.put_nowait
    envelope = bar_call[0][1]

    # Verify envelope structure matches protocol
    assert envelope["v"] == 1
    assert envelope["type"] == "bar"
    assert envelope["seq"] == 1
    assert "payload" in envelope

    payload = envelope["payload"]
    for key in ("ts_event", "open", "high", "low", "close", "volume"):
        assert key in payload
    # Enriched order-flow fields (additive, protocol stays v1).
    for key in ("buy_volume", "sell_volume", "delta"):
        assert key in payload

    # Verify timestamp conversion (nanoseconds → milliseconds)
    assert payload["ts_event"] == 1580395680000  # 1580395680000000000 // 1_000_000
    assert payload["open"] == 0.6700
    assert payload["high"] == 0.6705
    assert payload["low"] == 0.6698
    assert payload["close"] == 0.6702
    assert payload["volume"] == 100000


def test_sequence_monotonicity(actor, mock_queue, mock_loop):
    """Test that sequence numbers are monotonic across dual-envelope emissions."""
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

    # 10 bars × 2 envelopes (bar + cvd) = 20 enqueues.
    assert mock_loop.call_soon_threadsafe.call_count == 20

    # Extract all sequence numbers in emission order.
    seq_numbers = [
        call[0][1]["seq"] for call in mock_loop.call_soon_threadsafe.call_args_list
    ]

    # Global monotonic counter across both types: [1, 2, 3, ..., 20].
    assert seq_numbers == list(range(1, 21))
    assert len(set(seq_numbers)) == len(seq_numbers)  # no duplicates

    # Bar envelopes take odd seqs, cvd envelopes the following even seqs.
    bar_seqs = [
        call[0][1]["seq"]
        for call in mock_loop.call_soon_threadsafe.call_args_list
        if call[0][1]["type"] == "bar"
    ]
    cvd_seqs = [
        call[0][1]["seq"]
        for call in mock_loop.call_soon_threadsafe.call_args_list
        if call[0][1]["type"] == "cvd"
    ]
    assert bar_seqs == list(range(1, 21, 2))
    assert cvd_seqs == list(range(2, 21, 2))


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

        # Extract the bar envelope (first of the last bar+cvd pair).
        bar_call = mock_loop.call_soon_threadsafe.call_args_list[-2]
        envelope = bar_call[0][1]

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
    assert mock_loop.call_soon_threadsafe.call_count == 2

    # Verify the callable is queue.put_nowait for every enqueue
    for call in mock_loop.call_soon_threadsafe.call_args_list:
        assert call[0][0] == mock_queue.put_nowait

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

    # Bar envelope is the first enqueue; verify its OHLCV fields are floats.
    bar_call = mock_loop.call_soon_threadsafe.call_args_list[0]
    envelope = bar_call[0][1]
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


# ------------------------------------------------------------------------------
# Order-flow: trade bucketing, delta and cumulative CVD (issue-03) + enriched
# bar / cvd envelope schema (issue-05).
# ------------------------------------------------------------------------------

_MIN = 60_000_000_000  # one minute in nanoseconds


def _trade(ts_event, size, side):
    return MockTradeTick(ts_event=ts_event, size=size, aggressor_side=side)


def test_trade_bucketing(actor):
    """5 BUYER trades (10.5) and 3 SELLER trades (6.2) in one minute bucket."""
    minute = 1_597_399_200_000_000_000  # aligned to a minute boundary
    buys = [2.0, 2.5, 2.0, 2.0, 2.0]  # sum 10.5
    sells = [2.2, 2.0, 2.0]  # sum 6.2
    for i, sz in enumerate(buys):
        actor.on_trade_tick(_trade(minute + i * 1000, sz, AggressorSide.BUYER))
    for i, sz in enumerate(sells):
        actor.on_trade_tick(_trade(minute + 100 + i * 1000, sz, AggressorSide.SELLER))

    bucket = actor._buckets[minute]
    assert bucket["buy_volume"] == pytest.approx(10.5, abs=0.01)
    assert bucket["sell_volume"] == pytest.approx(6.2, abs=0.01)
    assert bucket["buy_volume"] - bucket["sell_volume"] == pytest.approx(4.3, abs=0.01)


def test_trade_bucketing_keys_by_minute(actor):
    """Trades in different minutes land in separate buckets."""
    m0 = 1_597_399_200_000_000_000
    m1 = m0 + _MIN
    actor.on_trade_tick(_trade(m0 + 5, 1.0, AggressorSide.BUYER))
    actor.on_trade_tick(_trade(m0 + _MIN - 1, 2.0, AggressorSide.SELLER))  # still m0
    actor.on_trade_tick(_trade(m1 + 5, 3.0, AggressorSide.BUYER))
    assert set(actor._buckets.keys()) == {m0, m1}
    assert actor._buckets[m0]["buy_volume"] == pytest.approx(1.0)
    assert actor._buckets[m0]["sell_volume"] == pytest.approx(2.0)
    assert actor._buckets[m1]["buy_volume"] == pytest.approx(3.0)


def test_cvd_cumulative(actor, mock_queue, mock_loop):
    """Deltas [5, -3, 7] over three bars produce CVD sequence [5, 2, 9]."""
    actor.set_queue(mock_queue, mock_loop)
    actor.log = MagicMock()

    # Build three consecutive minutes with buckets that yield deltas 5, -3, 7.
    specs = [
        (5.0, 0.0),   # delta +5
        (0.0, 3.0),   # delta -3
        (7.0, 0.0),   # delta +7
    ]
    base_start = 1_597_399_200_000_000_000  # a bar's interval START
    for i, (buy, sell) in enumerate(specs):
        minute = base_start + i * _MIN
        if buy:
            actor.on_trade_tick(_trade(minute + 1, buy, AggressorSide.BUYER))
        if sell:
            actor.on_trade_tick(_trade(minute + 1, sell, AggressorSide.SELLER))
        # Bar closes at interval end (start + 1 minute).
        bar = MockBar(
            ts_event=minute + _MIN,
            open_price=100.0, high=101.0, low=99.0, close=100.5, volume=buy + sell,
        )
        actor.on_bar(bar)

    # Collect cvd envelopes in order.
    cvd_values = [
        call[0][1]["payload"]["cvd"]
        for call in mock_loop.call_soon_threadsafe.call_args_list
        if call[0][1]["type"] == "cvd"
    ]
    assert cvd_values == pytest.approx([5.0, 2.0, 9.0])
    assert actor._cvd == pytest.approx(9.0)


def test_bucket_cleanup_after_bar(actor, mock_queue, mock_loop):
    """The correlated bucket is drained (popped) once its bar closes."""
    actor.set_queue(mock_queue, mock_loop)
    actor.log = MagicMock()
    start = 1_597_399_200_000_000_000
    actor.on_trade_tick(_trade(start + 1, 4.0, AggressorSide.BUYER))
    assert start in actor._buckets
    actor.on_bar(MockBar(start + _MIN, 1.0, 2.0, 0.5, 1.5, 4.0))
    assert start not in actor._buckets  # popped


def test_enriched_bar_payload(actor, mock_queue, mock_loop):
    """Bar envelope carries finite buy_volume/sell_volume/delta; v=1, type='bar'."""
    import math

    actor.set_queue(mock_queue, mock_loop)
    actor.log = MagicMock()
    start = 1_597_399_200_000_000_000
    actor.on_trade_tick(_trade(start + 1, 7.0, AggressorSide.BUYER))
    actor.on_trade_tick(_trade(start + 2, 2.5, AggressorSide.SELLER))
    actor.on_bar(MockBar(start + _MIN, 100.0, 101.0, 99.0, 100.5, 9.5))

    bar_env = mock_loop.call_soon_threadsafe.call_args_list[0][0][1]
    assert bar_env["v"] == 1
    assert bar_env["type"] == "bar"
    payload = bar_env["payload"]
    assert payload["buy_volume"] == pytest.approx(7.0)
    assert payload["sell_volume"] == pytest.approx(2.5)
    assert payload["delta"] == pytest.approx(4.5)
    for key in ("buy_volume", "sell_volume", "delta"):
        assert math.isfinite(payload[key])


def test_enriched_bar_missing_bucket_defaults_zero(actor, mock_queue, mock_loop):
    """A bar with no matching trade bucket reports zero order-flow, delta 0."""
    actor.set_queue(mock_queue, mock_loop)
    actor.log = MagicMock()
    actor.on_bar(MockBar(1_597_399_200_000_000_000 + _MIN, 100.0, 101.0, 99.0, 100.5, 0.0))
    payload = mock_loop.call_soon_threadsafe.call_args_list[0][0][1]["payload"]
    assert payload["buy_volume"] == 0.0
    assert payload["sell_volume"] == 0.0
    assert payload["delta"] == 0.0


def test_cvd_envelope_schema(actor, mock_queue, mock_loop):
    """CVD envelope: v=1, type='cvd', payload {ts_event, cvd, delta}, seq > bar seq."""
    import math

    actor.set_queue(mock_queue, mock_loop)
    actor.log = MagicMock()
    start = 1_597_399_200_000_000_000
    actor.on_trade_tick(_trade(start + 1, 3.0, AggressorSide.SELLER))
    actor.on_bar(MockBar(start + _MIN, 100.0, 101.0, 99.0, 100.5, 3.0))

    bar_env = mock_loop.call_soon_threadsafe.call_args_list[0][0][1]
    cvd_env = mock_loop.call_soon_threadsafe.call_args_list[1][0][1]
    assert cvd_env["v"] == 1
    assert cvd_env["type"] == "cvd"
    assert cvd_env["seq"] > bar_env["seq"]
    payload = cvd_env["payload"]
    assert set(payload.keys()) == {"ts_event", "cvd", "delta"}
    assert payload["cvd"] == pytest.approx(-3.0)
    assert payload["delta"] == pytest.approx(-3.0)
    for key in payload:
        assert math.isfinite(payload[key])


def test_zero_delta_balanced_flow(actor, mock_queue, mock_loop):
    """Equal buy/sell volume yields delta 0 and unchanged CVD."""
    actor.set_queue(mock_queue, mock_loop)
    actor.log = MagicMock()
    start = 1_597_399_200_000_000_000
    actor.on_trade_tick(_trade(start + 1, 5.0, AggressorSide.BUYER))
    actor.on_trade_tick(_trade(start + 2, 5.0, AggressorSide.SELLER))
    actor.on_bar(MockBar(start + _MIN, 100.0, 101.0, 99.0, 100.5, 10.0))
    cvd_env = mock_loop.call_soon_threadsafe.call_args_list[1][0][1]
    assert cvd_env["payload"]["delta"] == 0.0
    assert cvd_env["payload"]["cvd"] == 0.0