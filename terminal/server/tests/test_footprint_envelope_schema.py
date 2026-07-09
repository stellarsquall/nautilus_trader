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

_SHADOWED_MODULE_NAMES = (
    "nautilus_trader",
    "nautilus_trader.common",
    "nautilus_trader.common.actor",
    "nautilus_trader.config",
    "nautilus_trader.model",
    "nautilus_trader.model.data",
    "nautilus_trader.model.enums",
    "nautilus_trader.model.identifiers",
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
sys.modules["nautilus_trader.model.identifiers"] = MagicMock()


class MockActorBase:
    """Mock base Actor class."""
    def __init__(self, config=None):
        self.log = MagicMock()


import msgspec


class MockActorConfigBase(msgspec.Struct, kw_only=True, frozen=True):
    """Mock base ActorConfig class."""
    pass


sys.modules["nautilus_trader.common.actor"].Actor = MockActorBase
sys.modules["nautilus_trader.config"].ActorConfig = MockActorConfigBase

sys.modules.pop("terminal.server.bar_streaming_actor", None)

from terminal.server.bar_streaming_actor import BarStreamingActor
from terminal.server.bar_streaming_actor import BarStreamingActorConfig

from nautilus_trader.model.enums import AggressorSide


def _restore_shadowed_modules() -> None:
    for name, original in _SAVED_MODULES.items():
        if original is None:
            sys.modules.pop(name, None)
        else:
            sys.modules[name] = original


_restore_shadowed_modules()


def teardown_module(module):  # noqa: ARG001
    _restore_shadowed_modules()


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
    """Mock TradeTick object."""

    def __init__(self, ts_event: int, size: float, aggressor_side, price: float = 100.0) -> None:
        self.ts_event = ts_event
        self.size = size
        self.aggressor_side = aggressor_side
        self.price = price


_MIN = 60_000_000_000  # one minute in nanoseconds


def _trade(ts_event, size, side, price=100.0):
    return MockTradeTick(ts_event=ts_event, size=size, aggressor_side=side, price=price)


@pytest.fixture
def mock_queue():
    queue = Mock(spec=asyncio.Queue)
    queue.put_nowait = Mock()
    return queue


@pytest.fixture
def mock_loop():
    loop = Mock(spec=asyncio.AbstractEventLoop)
    loop.call_soon_threadsafe = Mock()
    return loop


@pytest.fixture
def actor_config():
    return BarStreamingActorConfig(bin_size=0.1)


@pytest.fixture
def actor(actor_config):
    return BarStreamingActor(config=actor_config)


# ------------------------------------------------------------------------------
# AC1: on_bar() emits footprint envelope as third envelope per bar
# ------------------------------------------------------------------------------


def test_footprint_is_third_envelope(actor, mock_queue, mock_loop):
    """Footprint envelope is the third emission after bar and CVD."""
    actor.set_queue(mock_queue, mock_loop)
    actor.log = MagicMock()

    start = 1_597_399_200_000_000_000
    actor.on_trade_tick(_trade(start + 1, 5.0, AggressorSide.BUYER))
    actor.on_bar(MockBar(start + _MIN, 100.0, 101.0, 99.0, 100.5, 5.0))

    assert mock_loop.call_soon_threadsafe.call_count == 3

    footprint_call = mock_loop.call_soon_threadsafe.call_args_list[2]
    envelope = footprint_call[0][1]
    assert envelope["type"] == "footprint"


def test_footprint_seq_after_cvd(actor, mock_queue, mock_loop):
    """Footprint seq equals CVD seq + 1 for the same bar."""
    actor.set_queue(mock_queue, mock_loop)
    actor.log = MagicMock()

    start = 1_597_399_200_000_000_000
    actor.on_trade_tick(_trade(start + 1, 3.0, AggressorSide.BUYER))
    actor.on_bar(MockBar(start + _MIN, 100.0, 101.0, 99.0, 100.5, 3.0))

    calls = mock_loop.call_soon_threadsafe.call_args_list
    bar_env = calls[0][0][1]
    cvd_env = calls[1][0][1]
    footprint_env = calls[2][0][1]

    assert bar_env["seq"] == 1
    assert cvd_env["seq"] == 2
    assert footprint_env["seq"] == 3


# ------------------------------------------------------------------------------
# AC2: footprint envelope matches exact schema
# ------------------------------------------------------------------------------


def test_footprint_envelope_schema(actor, mock_queue, mock_loop):
    """Footprint envelope matches {v, type, seq, payload{ts_event, bin_size, levels}}."""
    actor.set_queue(mock_queue, mock_loop)
    actor.log = MagicMock()

    start = 1_597_399_200_000_000_000
    actor.on_trade_tick(_trade(start + 1, 4.0, AggressorSide.BUYER, price=100.04))
    actor.on_trade_tick(_trade(start + 2, 2.0, AggressorSide.SELLER, price=100.14))
    actor.on_bar(MockBar(start + _MIN, 100.0, 101.0, 99.0, 100.5, 6.0))

    footprint_call = mock_loop.call_soon_threadsafe.call_args_list[2]
    envelope = footprint_call[0][1]

    assert envelope["v"] == 1
    assert envelope["type"] == "footprint"
    assert isinstance(envelope["seq"], int)
    assert envelope["seq"] > 0

    payload = envelope["payload"]
    assert isinstance(payload["ts_event"], int)
    assert payload["ts_event"] == (start + _MIN) // 1_000_000
    assert isinstance(payload["bin_size"], float)
    assert payload["bin_size"] == 0.1
    assert isinstance(payload["levels"], list)

    for level in payload["levels"]:
        assert isinstance(level["price"], float)
        assert isinstance(level["buy"], float)
        assert isinstance(level["sell"], float)
        assert level["buy"] >= 0
        assert level["sell"] >= 0


def test_footprint_ts_event_matches_bar(actor, mock_queue, mock_loop):
    """Footprint ts_event matches the corresponding bar timestamp."""
    actor.set_queue(mock_queue, mock_loop)
    actor.log = MagicMock()

    start = 1_597_399_200_000_000_000
    actor.on_trade_tick(_trade(start + 1, 1.0, AggressorSide.BUYER))
    actor.on_bar(MockBar(start + _MIN, 100.0, 101.0, 99.0, 100.5, 1.0))

    calls = mock_loop.call_soon_threadsafe.call_args_list
    bar_env = calls[0][0][1]
    footprint_env = calls[2][0][1]

    assert bar_env["payload"]["ts_event"] == footprint_env["payload"]["ts_event"]


# ------------------------------------------------------------------------------
# AC3: levels array contains only non-empty bins sorted by price ascending
# ------------------------------------------------------------------------------


def test_footprint_sparse_encoding(actor, mock_queue, mock_loop):
    """Levels array contains only non-empty bins sorted by price ascending."""
    actor.set_queue(mock_queue, mock_loop)
    actor.log = MagicMock()

    start = 1_597_399_200_000_000_000
    # Trades at three different price levels (adjusted to avoid banker's rounding edge cases)
    actor.on_trade_tick(_trade(start + 1, 2.0, AggressorSide.BUYER, price=100.04))
    actor.on_trade_tick(_trade(start + 2, 3.0, AggressorSide.BUYER, price=100.24))
    actor.on_trade_tick(_trade(start + 3, 1.5, AggressorSide.SELLER, price=100.04))
    actor.on_trade_tick(_trade(start + 4, 0.5, AggressorSide.SELLER, price=100.14))
    actor.on_bar(MockBar(start + _MIN, 100.0, 101.0, 99.0, 100.5, 7.0))

    footprint_call = mock_loop.call_soon_threadsafe.call_args_list[2]
    levels = footprint_call[0][1]["payload"]["levels"]

    # Verify sorted ascending by price
    for i in range(len(levels) - 1):
        assert levels[i]["price"] < levels[i + 1]["price"]

    # Verify no empty levels (both buy and sell must be > 0)
    for level in levels:
        assert level["buy"] > 0 or level["sell"] > 0

    # Verify known levels
    expected = [
        {"price": 100.0, "buy": 2.0, "sell": 1.5},
        {"price": 100.1, "buy": 0.0, "sell": 0.5},
        {"price": 100.2, "buy": 3.0, "sell": 0.0},
    ]
    assert len(levels) == len(expected)
    for actual, exp in zip(levels, expected):
        assert actual["price"] == pytest.approx(exp["price"], abs=0.001)
        assert actual["buy"] == pytest.approx(exp["buy"], abs=0.001)
        assert actual["sell"] == pytest.approx(exp["sell"], abs=0.001)


# ------------------------------------------------------------------------------
# AC4: ts_event matches corresponding bar timestamp (tested with AC2 above)
# AC5: Empty intervals produce levels:[]
# ------------------------------------------------------------------------------


def test_footprint_empty_interval(actor, mock_queue, mock_loop):
    """Empty interval (no trades) produces levels:[] for the footprint envelope."""
    actor.set_queue(mock_queue, mock_loop)
    actor.log = MagicMock()

    # No trades — just a bar with no bucket
    start = 1_597_399_200_000_000_000
    actor.on_bar(MockBar(start + _MIN, 100.0, 101.0, 99.0, 100.5, 0.0))

    footprint_call = mock_loop.call_soon_threadsafe.call_args_list[2]
    envelope = footprint_call[0][1]

    assert envelope["type"] == "footprint"
    assert envelope["payload"]["levels"] == []


def test_footprint_empty_interval_after_populated(actor, mock_queue, mock_loop):
    """A populated interval then an empty interval: empty produces levels:[]."""
    actor.set_queue(mock_queue, mock_loop)
    actor.log = MagicMock()

    start = 1_597_399_200_000_000_000
    # First bar with trades
    actor.on_trade_tick(_trade(start + 1, 3.0, AggressorSide.BUYER, price=100.04))
    actor.on_bar(MockBar(start + _MIN, 100.0, 101.0, 99.0, 100.5, 3.0))

    # Second bar with no trades
    bar2_start = start + _MIN
    actor.on_bar(MockBar(bar2_start + _MIN, 101.0, 102.0, 100.5, 101.5, 0.0))

    calls = mock_loop.call_soon_threadsafe.call_args_list
    footprint1 = calls[2][0][1]
    footprint2 = calls[5][0][1]

    assert len(footprint1["payload"]["levels"]) > 0
    assert footprint2["payload"]["levels"] == []


# ------------------------------------------------------------------------------
# AC6: Sequence numbers remain monotonic across all envelope types
# ------------------------------------------------------------------------------


def test_sequence_monotonic_across_all_types(actor, mock_queue, mock_loop):
    """Sequence numbers remain monotonic across bar, cvd, and footprint envelopes."""
    actor.set_queue(mock_queue, mock_loop)
    actor.log = MagicMock()

    start = 1_597_399_200_000_000_000
    for i in range(3):
        minute = start + i * _MIN
        actor.on_trade_tick(_trade(minute + 1, 1.0, AggressorSide.BUYER))
        actor.on_bar(MockBar(minute + _MIN, 100.0, 101.0, 99.0, 100.5, 1.0))

    seq_numbers = [
        call[0][1]["seq"] for call in mock_loop.call_soon_threadsafe.call_args_list
    ]

    # 3 bars × 3 envelopes = 9 emissions
    assert seq_numbers == list(range(1, 10))
    assert seq_numbers == sorted(seq_numbers)  # monotonic
    assert len(set(seq_numbers)) == len(seq_numbers)  # no duplicates

    # Verify ordering within each bar: bar < cvd < footprint
    types = [
        call[0][1]["type"] for call in mock_loop.call_soon_threadsafe.call_args_list
    ]
    for i in range(0, 9, 3):
        assert types[i] == "bar"
        assert types[i + 1] == "cvd"
        assert types[i + 2] == "footprint"


# ------------------------------------------------------------------------------
# Edge cases
# ------------------------------------------------------------------------------


def test_footprint_custom_bin_size(actor, mock_queue, mock_loop):
    """Custom bin_size config is reflected in footprint payload."""
    config = BarStreamingActorConfig(bin_size=0.5)
    custom_actor = BarStreamingActor(config=config)
    custom_actor.set_queue(mock_queue, mock_loop)
    custom_actor.log = MagicMock()

    start = 1_597_399_200_000_000_000
    custom_actor.on_trade_tick(_trade(start + 1, 2.0, AggressorSide.BUYER, price=100.4))
    custom_actor.on_bar(MockBar(start + _MIN, 100.0, 101.0, 99.0, 100.5, 2.0))

    footprint_call = mock_loop.call_soon_threadsafe.call_args_list[2]
    payload = footprint_call[0][1]["payload"]

    assert payload["bin_size"] == 0.5
    # With bin_size=0.5, price=100.4 rounds to 100.5 (100.4/0.5=200.8 round=201 201*0.5=100.5)
    for level in payload["levels"]:
        assert level["price"] == pytest.approx(100.5)