"""Integration tests for WebSocket envelope emission with mock queue."""

import asyncio
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from terminal.server.websocket import ConnectionManager, websocket_endpoint
from terminal.server.replay_buffer import ReplayBuffer
from terminal.server import websocket as ws_module


def create_test_envelope(seq: int, ts_event: int = 1580395680000) -> dict:
    """
    Create a test envelope matching production schema.

    Parameters
    ----------
    seq : int
        Sequence number for the envelope.
    ts_event : int, default 1580395680000
        Event timestamp in milliseconds (2020-01-30).

    Returns
    -------
    dict
        Test envelope with valid OHLC relationships.

    """
    # Generate realistic OHLC data with valid relationships
    base_price = 0.6700 + (seq * 0.0001)
    return {
        "v": 1,
        "type": "bar",
        "seq": seq,
        "payload": {
            "ts_event": ts_event + (seq * 60000),  # 1-minute intervals
            "open": base_price,
            "high": base_price + 0.0005,  # high is maximum
            "low": base_price - 0.0002,   # low is minimum
            "close": base_price + 0.0002,
            "volume": 100000,
        },
    }


@pytest.fixture
def mock_queue_messages():
    """
    Generate 20 valid test envelopes matching production schema.

    Returns
    -------
    list[dict]
        20 bar envelopes with valid OHLC relationships and monotonic timestamps.

    """
    return [create_test_envelope(i + 1) for i in range(20)]


@pytest.fixture
def mock_app(mock_queue_messages):
    """
    FastAPI app with mocked queue for testing.

    Overrides the global manager to inject a pre-populated queue,
    avoiding lifespan startup that runs the real backtest.

    Parameters
    ----------
    mock_queue_messages : list[dict]
        Pre-generated test envelopes.

    Returns
    -------
    FastAPI
        Test app with mocked WebSocket endpoint.

    """
    # Create test app without lifespan
    test_app = FastAPI()

    # Initialize replay buffer and connection manager
    replay_buffer = ReplayBuffer(capacity=100)
    manager = ConnectionManager(replay_buffer)

    # Pre-populate replay buffer with mock messages
    for msg in mock_queue_messages:
        replay_buffer.add(msg)

    # Set global manager for websocket_endpoint
    ws_module.manager = manager

    # Add WebSocket route
    test_app.websocket("/ws")(websocket_endpoint)

    return test_app


def test_websocket_emits_valid_envelopes(mock_app, mock_queue_messages):
    """
    Assert envelope structure: v=1, type='bar', seq>0, payload keys, ts_event range.

    Tests that the WebSocket endpoint emits envelopes with correct structure:
    - Version is 1
    - Type is 'bar'
    - Sequence number is integer > 0
    - Payload contains required keys
    - Timestamp is in valid 2020 range (1580000000000..1590000000000)

    """
    with TestClient(mock_app) as client:
        with client.websocket_connect("/ws") as websocket:
            messages = []
            for _ in range(10):
                msg = websocket.receive_json()
                messages.append(msg)

            # Assert all 10 messages have valid envelope structure
            for msg in messages:
                assert msg["v"] == 1, "Envelope version must be 1"
                assert msg["type"] == "bar", "Slice 1 emits only type='bar'"
                assert isinstance(msg["seq"], int), "Sequence number must be integer"
                assert msg["seq"] > 0, "Sequence number must be > 0"
                assert "payload" in msg, "Envelope must contain payload"

                payload = msg["payload"]
                # Assert payload has all required keys
                required_keys = ["ts_event", "open", "high", "low", "close", "volume"]
                for key in required_keys:
                    assert key in payload, f"Payload missing required key: {key}"

                # Assert timestamp is in valid 2020 range (milliseconds)
                ts_event = payload["ts_event"]
                assert isinstance(ts_event, int), "ts_event must be integer"
                assert 1580000000000 <= ts_event <= 1590000000000, \
                    f"ts_event {ts_event} not in valid 2020 range"


def test_bar_ohlc_relationships(mock_app):
    """
    Validate OHLC invariants: high is max, low is min, all positive.

    Tests that each bar payload satisfies OHLC relationships:
    - high >= open, close, low (high is maximum)
    - low <= open, close, high (low is minimum)
    - All prices > 0

    """
    with TestClient(mock_app) as client:
        with client.websocket_connect("/ws") as websocket:
            messages = []
            for _ in range(10):
                msg = websocket.receive_json()
                messages.append(msg)

            for msg in messages:
                payload = msg["payload"]
                o = payload["open"]
                h = payload["high"]
                l = payload["low"]  # noqa: E741
                c = payload["close"]

                # Assert high is maximum
                assert h >= o, f"high {h} < open {o}"
                assert h >= c, f"high {h} < close {c}"
                assert h >= l, f"high {h} < low {l}"

                # Assert low is minimum
                assert l <= o, f"low {l} > open {o}"
                assert l <= c, f"low {l} > close {c}"
                assert l <= h, f"low {l} > high {h}"

                # Assert all prices are positive
                assert o > 0, f"open {o} must be positive"
                assert h > 0, f"high {h} must be positive"
                assert l > 0, f"low {l} must be positive"
                assert c > 0, f"close {c} must be positive"


def test_monotonic_sequence_numbers(mock_app):
    """
    Verify sequence numbers increase monotonically with no duplicates.

    Tests that sequence numbers:
    - Are sorted in ascending order
    - Have no duplicate values

    """
    with TestClient(mock_app) as client:
        with client.websocket_connect("/ws") as websocket:
            messages = []
            for _ in range(10):
                msg = websocket.receive_json()
                messages.append(msg)

            seqs = [msg["seq"] for msg in messages]

            # Assert sequence numbers are sorted (monotonic increasing)
            assert seqs == sorted(seqs), \
                f"Sequence numbers not monotonic: {seqs}"

            # Assert no duplicate sequence numbers
            assert len(set(seqs)) == len(seqs), \
                f"Duplicate sequence numbers found: {seqs}"


def test_timestamp_monotonicity(mock_app):
    """
    Assert ts_event values are sorted ascending across messages.

    Tests that timestamps increase monotonically across all messages,
    ensuring bars are emitted in chronological order.

    """
    with TestClient(mock_app) as client:
        with client.websocket_connect("/ws") as websocket:
            messages = []
            for _ in range(10):
                msg = websocket.receive_json()
                messages.append(msg)

            timestamps = [msg["payload"]["ts_event"] for msg in messages]

            # Assert timestamps are sorted (monotonic increasing)
            assert timestamps == sorted(timestamps), \
                f"Timestamps not monotonic: {timestamps}"
