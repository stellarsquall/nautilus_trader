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

"""FastAPI application with lifespan and endpoints."""

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from terminal.server.backtest import create_backtest_queue
from terminal.server.backtest import run_backtest_with_delay
from terminal.server.replay_buffer import ReplayBuffer
from terminal.server.websocket import ConnectionManager
from terminal.server.websocket import websocket_endpoint
from terminal.server import websocket as ws_module


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Lifespan context manager for startup/shutdown.

    Startup:
    --------
    - Gets running event loop
    - Creates backtest engine and queue via create_backtest_queue()
    - Initializes ReplayBuffer and ConnectionManager
    - Starts background task for broadcast_from_queue()
    - Starts background task for run_backtest_with_delay()
    - Prints startup message

    Shutdown:
    ---------
    - Awaits backtest_task completion
    - Cancels broadcast_task

    """
    # Startup
    loop = asyncio.get_running_loop()
    engine, queue = create_backtest_queue(loop, delay_ms=50)

    # Initialize replay buffer and connection manager
    replay_buffer = ReplayBuffer(capacity=100)
    ws_module.manager = ConnectionManager(replay_buffer)

    # Background task to broadcast from queue
    async def broadcast_from_queue():
        while True:
            envelope = await queue.get()
            if envelope is None:
                # EOF signal from backtest
                break
            await ws_module.manager.broadcast(envelope)

    # Start background tasks
    broadcast_task = asyncio.create_task(broadcast_from_queue())
    backtest_task = asyncio.create_task(run_backtest_with_delay(engine, queue))

    print("Server running at http://localhost:8000")

    yield

    # Shutdown
    await backtest_task
    broadcast_task.cancel()
    try:
        await broadcast_task
    except asyncio.CancelledError:
        pass


# Create FastAPI app with lifespan
app = FastAPI(lifespan=lifespan)

# Add WebSocket route using decorator pattern (FastAPI standard)
app.websocket("/ws")(websocket_endpoint)

# Mount static files (client build output)
# Note: This will fail if terminal/client/dist/ doesn't exist yet
# Run `cd terminal/client && npm install && npm run build` first
try:
    app.mount("/", StaticFiles(directory="terminal/client/dist", html=True), name="static")
except RuntimeError:
    # dist/ directory not built yet - this is expected during tests
    pass
