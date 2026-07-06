"""Unit tests for ConnectionManager connection lifecycle, broadcast, and failure handling."""

import pytest
from unittest.mock import AsyncMock
from unittest.mock import MagicMock

from terminal.server.replay_buffer import ReplayBuffer
from terminal.server.websocket import ConnectionManager
from terminal.server.websocket import websocket_endpoint


def create_test_envelope(seq: int, ts_event: int = 1580395680000) -> dict:
    """
    Create a test envelope matching production schema.

    Parameters
    ----------
    seq : int
        Sequence number for the envelope.
    ts_event : int, default 1580395680000
        Event timestamp in milliseconds.

    Returns
    -------
    dict
        Test envelope with valid structure.

    """
    return {
        "v": 1,
        "type": "bar",
        "seq": seq,
        "payload": {
            "ts_event": ts_event + (seq * 60000),  # 1-minute intervals
            "open": 0.6700 + (seq * 0.0001),
            "high": 0.6705 + (seq * 0.0001),
            "low": 0.6698 + (seq * 0.0001),
            "close": 0.6702 + (seq * 0.0001),
            "volume": 100000,
        },
    }


def create_mock_websocket() -> MagicMock:
    """
    Create a mock WebSocket with async methods.

    Returns
    -------
    MagicMock
        Mock WebSocket with accept(), send_json(), and receive_text() methods.

    """
    ws = MagicMock()
    ws.accept = AsyncMock()
    ws.send_json = AsyncMock()
    ws.receive_text = AsyncMock()
    return ws


class TestConnectionManagerInit:
    """Test ConnectionManager initialization."""

    def test_init_stores_replay_buffer(self):
        """Test __init__ stores replay buffer reference (AC1)."""
        replay_buffer = ReplayBuffer(capacity=100)
        manager = ConnectionManager(replay_buffer=replay_buffer)

        assert manager._replay_buffer is replay_buffer, "Replay buffer not stored"
        assert manager._active_connections == [], "Active connections should be empty"


class TestConnectionManagerConnect:
    """Test ConnectionManager.connect() method."""

    @pytest.mark.asyncio
    async def test_connect_accepts_websocket(self):
        """Test connect() accepts the WebSocket connection (AC2)."""
        replay_buffer = ReplayBuffer(capacity=100)
        manager = ConnectionManager(replay_buffer=replay_buffer)
        ws = create_mock_websocket()

        await manager.connect(ws)

        ws.accept.assert_called_once()

    @pytest.mark.asyncio
    async def test_connect_sends_replay_buffer_envelopes(self):
        """Test connect() sends all replay buffer envelopes to new client (AC2, AC7)."""
        replay_buffer = ReplayBuffer(capacity=100)

        # Pre-populate replay buffer with 5 envelopes
        envelopes = [create_test_envelope(i + 1) for i in range(5)]
        for env in envelopes:
            replay_buffer.add(env)

        manager = ConnectionManager(replay_buffer=replay_buffer)
        ws = create_mock_websocket()

        await manager.connect(ws)

        # Verify all 5 envelopes were sent
        assert ws.send_json.call_count == 5, "Should send all replay buffer envelopes"

        # Verify envelopes sent in correct order
        sent_envelopes = [call[0][0] for call in ws.send_json.call_args_list]
        assert sent_envelopes == envelopes, "Envelopes not sent in chronological order"

    @pytest.mark.asyncio
    async def test_connect_appends_to_active_connections(self):
        """Test connect() appends websocket to active connections list (AC2)."""
        replay_buffer = ReplayBuffer(capacity=100)
        manager = ConnectionManager(replay_buffer=replay_buffer)
        ws = create_mock_websocket()

        await manager.connect(ws)

        assert ws in manager._active_connections, "WebSocket not added to active connections"
        assert len(manager._active_connections) == 1

    @pytest.mark.asyncio
    async def test_connect_with_empty_replay_buffer(self):
        """Test connect() when replay buffer is empty (edge case)."""
        replay_buffer = ReplayBuffer(capacity=100)
        manager = ConnectionManager(replay_buffer=replay_buffer)
        ws = create_mock_websocket()

        await manager.connect(ws)

        ws.accept.assert_called_once()
        ws.send_json.assert_not_called()
        assert ws in manager._active_connections

    @pytest.mark.asyncio
    async def test_connect_multiple_clients(self):
        """Test connect() with multiple clients."""
        replay_buffer = ReplayBuffer(capacity=100)

        # Pre-populate with 3 envelopes
        for i in range(3):
            replay_buffer.add(create_test_envelope(i + 1))

        manager = ConnectionManager(replay_buffer=replay_buffer)
        ws1 = create_mock_websocket()
        ws2 = create_mock_websocket()

        await manager.connect(ws1)
        await manager.connect(ws2)

        assert len(manager._active_connections) == 2
        assert ws1 in manager._active_connections
        assert ws2 in manager._active_connections

        # Both clients should receive replay buffer
        assert ws1.send_json.call_count == 3
        assert ws2.send_json.call_count == 3


class TestConnectionManagerDisconnect:
    """Test ConnectionManager.disconnect() method."""

    @pytest.mark.asyncio
    async def test_disconnect_removes_from_active_list(self):
        """Test disconnect() removes connection from active list (AC3)."""
        replay_buffer = ReplayBuffer(capacity=100)
        manager = ConnectionManager(replay_buffer=replay_buffer)
        ws = create_mock_websocket()

        await manager.connect(ws)
        assert ws in manager._active_connections

        manager.disconnect(ws)
        assert ws not in manager._active_connections
        assert len(manager._active_connections) == 0

    def test_disconnect_when_not_in_list_is_idempotent(self):
        """Test disconnect() when websocket not in list (edge case, idempotent)."""
        replay_buffer = ReplayBuffer(capacity=100)
        manager = ConnectionManager(replay_buffer=replay_buffer)
        ws = create_mock_websocket()

        # Disconnect without ever connecting (should not raise exception)
        manager.disconnect(ws)
        assert len(manager._active_connections) == 0

    @pytest.mark.asyncio
    async def test_disconnect_one_of_multiple_clients(self):
        """Test disconnect() removes only specified client."""
        replay_buffer = ReplayBuffer(capacity=100)
        manager = ConnectionManager(replay_buffer=replay_buffer)
        ws1 = create_mock_websocket()
        ws2 = create_mock_websocket()
        ws3 = create_mock_websocket()

        await manager.connect(ws1)
        await manager.connect(ws2)
        await manager.connect(ws3)

        manager.disconnect(ws2)

        assert ws1 in manager._active_connections
        assert ws2 not in manager._active_connections
        assert ws3 in manager._active_connections
        assert len(manager._active_connections) == 2


class TestConnectionManagerBroadcast:
    """Test ConnectionManager.broadcast() method."""

    @pytest.mark.asyncio
    async def test_broadcast_adds_to_replay_buffer(self):
        """Test broadcast() adds envelope to replay buffer before sending (AC4)."""
        replay_buffer = ReplayBuffer(capacity=100)
        manager = ConnectionManager(replay_buffer=replay_buffer)

        envelope = create_test_envelope(1)
        await manager.broadcast(envelope)

        cached = replay_buffer.get_all()
        assert len(cached) == 1
        assert cached[0] == envelope

    @pytest.mark.asyncio
    async def test_broadcast_sends_to_all_active_connections(self):
        """Test broadcast() sends to all active connections (AC4, AC8)."""
        replay_buffer = ReplayBuffer(capacity=100)
        manager = ConnectionManager(replay_buffer=replay_buffer)

        ws1 = create_mock_websocket()
        ws2 = create_mock_websocket()
        ws3 = create_mock_websocket()

        await manager.connect(ws1)
        await manager.connect(ws2)
        await manager.connect(ws3)

        # Clear call counts from connect()
        ws1.send_json.reset_mock()
        ws2.send_json.reset_mock()
        ws3.send_json.reset_mock()

        envelope = create_test_envelope(1)
        await manager.broadcast(envelope)

        # All three connections should receive the envelope
        ws1.send_json.assert_called_once_with(envelope)
        ws2.send_json.assert_called_once_with(envelope)
        ws3.send_json.assert_called_once_with(envelope)

    @pytest.mark.asyncio
    async def test_broadcast_with_no_active_connections(self):
        """Test broadcast() with no active connections (edge case)."""
        replay_buffer = ReplayBuffer(capacity=100)
        manager = ConnectionManager(replay_buffer=replay_buffer)

        envelope = create_test_envelope(1)
        await manager.broadcast(envelope)

        # Should add to replay buffer even with no connections
        cached = replay_buffer.get_all()
        assert len(cached) == 1
        assert cached[0] == envelope

    @pytest.mark.asyncio
    async def test_broadcast_removes_failed_connections(self):
        """Test broadcast() removes disconnected clients on send failure (AC5, AC8)."""
        replay_buffer = ReplayBuffer(capacity=100)
        manager = ConnectionManager(replay_buffer=replay_buffer)

        ws1 = create_mock_websocket()
        ws2 = create_mock_websocket()
        ws3 = create_mock_websocket()

        await manager.connect(ws1)
        await manager.connect(ws2)
        await manager.connect(ws3)

        # Clear call counts from connect()
        ws1.send_json.reset_mock()
        ws2.send_json.reset_mock()
        ws3.send_json.reset_mock()

        # Make ws2 fail on send
        ws2.send_json.side_effect = Exception("Connection closed")

        envelope = create_test_envelope(1)
        await manager.broadcast(envelope)

        # ws1 and ws3 should have received the message
        ws1.send_json.assert_called_once_with(envelope)
        ws3.send_json.assert_called_once_with(envelope)

        # ws2 should be removed from active connections
        assert ws1 in manager._active_connections
        assert ws2 not in manager._active_connections
        assert ws3 in manager._active_connections
        assert len(manager._active_connections) == 2

    @pytest.mark.asyncio
    async def test_broadcast_removes_multiple_failed_connections(self):
        """Test broadcast() removes multiple failed connections in one broadcast."""
        replay_buffer = ReplayBuffer(capacity=100)
        manager = ConnectionManager(replay_buffer=replay_buffer)

        ws1 = create_mock_websocket()
        ws2 = create_mock_websocket()
        ws3 = create_mock_websocket()
        ws4 = create_mock_websocket()

        await manager.connect(ws1)
        await manager.connect(ws2)
        await manager.connect(ws3)
        await manager.connect(ws4)

        # Clear call counts
        ws1.send_json.reset_mock()
        ws2.send_json.reset_mock()
        ws3.send_json.reset_mock()
        ws4.send_json.reset_mock()

        # Make ws2 and ws4 fail
        ws2.send_json.side_effect = Exception("Connection closed")
        ws4.send_json.side_effect = Exception("Connection closed")

        envelope = create_test_envelope(1)
        await manager.broadcast(envelope)

        # Only ws1 and ws3 should remain active
        assert ws1 in manager._active_connections
        assert ws2 not in manager._active_connections
        assert ws3 in manager._active_connections
        assert ws4 not in manager._active_connections
        assert len(manager._active_connections) == 2

    @pytest.mark.asyncio
    async def test_broadcast_sequence_adds_all_to_replay_buffer(self):
        """Test multiple broadcasts all add to replay buffer."""
        replay_buffer = ReplayBuffer(capacity=100)
        manager = ConnectionManager(replay_buffer=replay_buffer)

        ws = create_mock_websocket()
        await manager.connect(ws)

        # Broadcast 10 envelopes
        for i in range(10):
            envelope = create_test_envelope(i + 1)
            await manager.broadcast(envelope)

        # All should be in replay buffer
        cached = replay_buffer.get_all()
        assert len(cached) == 10
        assert [env["seq"] for env in cached] == list(range(1, 11))


class TestWebSocketEndpoint:
    """Test websocket_endpoint coroutine."""

    @pytest.mark.asyncio
    async def test_endpoint_calls_manager_connect(self):
        """Test websocket_endpoint() calls manager.connect() (AC6)."""
        from terminal.server import websocket as ws_module

        replay_buffer = ReplayBuffer(capacity=100)
        manager = ConnectionManager(replay_buffer=replay_buffer)
        ws_module.manager = manager

        ws = create_mock_websocket()

        # Make receive_text raise WebSocketDisconnect immediately
        from fastapi import WebSocketDisconnect

        ws.receive_text.side_effect = WebSocketDisconnect()

        await websocket_endpoint(ws)

        ws.accept.assert_called_once()

    @pytest.mark.asyncio
    async def test_endpoint_calls_manager_disconnect_on_exception(self):
        """Test websocket_endpoint() calls manager.disconnect() on WebSocketDisconnect (AC6)."""
        from terminal.server import websocket as ws_module

        replay_buffer = ReplayBuffer(capacity=100)
        manager = ConnectionManager(replay_buffer=replay_buffer)
        ws_module.manager = manager

        ws = create_mock_websocket()

        # Make receive_text raise WebSocketDisconnect immediately
        from fastapi import WebSocketDisconnect

        ws.receive_text.side_effect = WebSocketDisconnect()

        await websocket_endpoint(ws)

        # WebSocket should be disconnected (not in active connections)
        assert ws not in manager._active_connections

    @pytest.mark.asyncio
    async def test_endpoint_receive_loop(self):
        """Test websocket_endpoint() enters receive loop."""
        from terminal.server import websocket as ws_module

        replay_buffer = ReplayBuffer(capacity=100)
        manager = ConnectionManager(replay_buffer=replay_buffer)
        ws_module.manager = manager

        ws = create_mock_websocket()

        # Make receive_text return a few messages, then disconnect
        from fastapi import WebSocketDisconnect

        call_count = 0

        async def receive_side_effect():
            nonlocal call_count
            call_count += 1
            if call_count >= 3:
                raise WebSocketDisconnect()
            return "test message"

        ws.receive_text.side_effect = receive_side_effect

        await websocket_endpoint(ws)

        assert call_count == 3, "Should call receive_text multiple times"


class TestConnectionManagerIntegration:
    """Integration tests for realistic usage patterns."""

    @pytest.mark.asyncio
    async def test_realistic_late_joiner_scenario(self):
        """Test late joiner receives replay buffer and subsequent broadcasts."""
        replay_buffer = ReplayBuffer(capacity=100)
        manager = ConnectionManager(replay_buffer=replay_buffer)

        # First client connects and receives 10 broadcasts
        ws1 = create_mock_websocket()
        await manager.connect(ws1)

        for i in range(10):
            envelope = create_test_envelope(i + 1)
            await manager.broadcast(envelope)

        # Second client joins late
        ws2 = create_mock_websocket()
        await manager.connect(ws2)

        # ws2 should have received replay buffer (10 envelopes)
        assert ws2.send_json.call_count == 10

        # Clear counts
        ws1.send_json.reset_mock()
        ws2.send_json.reset_mock()

        # New broadcast should go to both
        envelope = create_test_envelope(11)
        await manager.broadcast(envelope)

        ws1.send_json.assert_called_once_with(envelope)
        ws2.send_json.assert_called_once_with(envelope)

    @pytest.mark.asyncio
    async def test_connection_lifecycle_end_to_end(self):
        """Test full lifecycle: connect, broadcast, disconnect."""
        replay_buffer = ReplayBuffer(capacity=100)
        manager = ConnectionManager(replay_buffer=replay_buffer)

        ws = create_mock_websocket()

        # Connect
        await manager.connect(ws)
        assert ws in manager._active_connections

        # Broadcast
        envelope = create_test_envelope(1)
        await manager.broadcast(envelope)
        ws.send_json.assert_called_once()

        # Disconnect
        manager.disconnect(ws)
        assert ws not in manager._active_connections

        # Future broadcasts should not reach disconnected client
        ws.send_json.reset_mock()
        envelope2 = create_test_envelope(2)
        await manager.broadcast(envelope2)
        ws.send_json.assert_not_called()
