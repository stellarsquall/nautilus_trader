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

"""WebSocket ConnectionManager and endpoint for real-time bar streaming."""

from fastapi import WebSocket
from fastapi import WebSocketDisconnect

from frontend.backend.replay_buffer import ReplayBuffer


class ConnectionManager:
    """
    Manager for WebSocket connections with replay buffer support.

    Manages active WebSocket connections, broadcasts envelopes to all connected
    clients, and sends replay buffer to late joiners. Automatically removes
    disconnected clients on send failure.

    Parameters
    ----------
    replay_buffer : ReplayBuffer
        The replay buffer containing recent envelopes for late joiners.

    """

    def __init__(self, replay_buffer: ReplayBuffer) -> None:
        """
        Initialize ConnectionManager with replay buffer.

        Parameters
        ----------
        replay_buffer : ReplayBuffer
            The replay buffer to send to new connections.

        """
        self._active_connections: list[WebSocket] = []
        self._replay_buffer = replay_buffer

    async def connect(self, websocket: WebSocket) -> None:
        """
        Accept a new WebSocket connection and send replay buffer.

        Accepts the WebSocket connection, sends all cached envelopes from the
        replay buffer, then adds the connection to the active connections list.
        Order is critical: replay buffer must be sent BEFORE adding to active
        connections to avoid duplicate messages.

        Parameters
        ----------
        websocket : WebSocket
            The WebSocket connection to accept and initialize.

        """
        await websocket.accept()
        await self._send_replay_buffer(websocket)
        self._active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket) -> None:
        """
        Remove a WebSocket from active connections.

        Removes the specified WebSocket from the active connections list.
        Idempotent: if the WebSocket is not in the list, this is a no-op.

        Parameters
        ----------
        websocket : WebSocket
            The WebSocket connection to remove.

        """
        if websocket in self._active_connections:
            self._active_connections.remove(websocket)

    async def broadcast(self, envelope: dict) -> None:
        """
        Broadcast envelope to all active connections and add to replay buffer.

        Adds the envelope to the replay buffer, then sends it to all active
        connections. If a send fails (client disconnected), that connection
        is automatically removed from the active list.

        Parameters
        ----------
        envelope : dict
            The WebSocket envelope to broadcast (contains v, type, seq, payload).

        """
        self._replay_buffer.add(envelope)

        disconnected = []
        for conn in self._active_connections:
            try:
                await conn.send_json(envelope)
            except Exception:
                # Connection failed, mark for removal
                disconnected.append(conn)

        # Remove disconnected clients
        for conn in disconnected:
            self.disconnect(conn)

    async def _send_replay_buffer(self, websocket: WebSocket) -> None:
        """
        Send all replay buffer envelopes to a WebSocket.

        Sends all cached envelopes from the replay buffer to the specified
        WebSocket in chronological order (oldest to newest).

        Parameters
        ----------
        websocket : WebSocket
            The WebSocket to receive replay buffer envelopes.

        """
        for envelope in self._replay_buffer.get_all():
            await websocket.send_json(envelope)


# Module-level manager instance (initialized in lifespan)
manager: ConnectionManager | None = None


async def websocket_endpoint(websocket: WebSocket) -> None:
    """
    WebSocket endpoint for FastAPI route.

    Accepts the WebSocket connection via the global ConnectionManager,
    then enters a receive loop. On WebSocketDisconnect, calls disconnect()
    to remove the connection from the active list.

    This endpoint is designed to be registered with FastAPI:
    ```python
    app.add_websocket_route("/ws", websocket_endpoint)
    ```

    Parameters
    ----------
    websocket : WebSocket
        The FastAPI WebSocket connection.

    """
    await manager.connect(websocket)
    try:
        while True:
            # Keep connection alive, receive and discard client messages
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
