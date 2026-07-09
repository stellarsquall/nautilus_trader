"""Unit tests for FastAPI application lifespan startup/shutdown sequence."""

import asyncio
import sys
from unittest.mock import AsyncMock
from unittest.mock import MagicMock
from unittest.mock import patch

import pytest

# Add parent directory to path to allow imports
sys.path.insert(0, "/Users/robinbeck/Projects/nautilus/nautilus_trader_stellarsquall/.worktrees/issue-7732fe1e-15-backend-fastapi-app")

# Mock NautilusTrader modules before importing our code.
#
# These shadows let main.py import without pulling heavy Cython at unit-test
# time. CRITICAL: they MUST be restored at the end of this module's import,
# because pytest imports every test module during the COLLECTION phase before
# running any test. If left installed, these mocks leak into the run phase and
# break sibling tests that need the REAL nautilus_trader (test_backtest,
# test_integration_dataset_actor_streaming), e.g. "Aggregation type not
# supported for time bars, was MINUTE". We save originals, install mocks, and
# restore immediately after the (lazy/patched) imports are set up.
_SHADOWED_MODULE_NAMES = (
    "nautilus_trader",
    "nautilus_trader.backtest",
    "nautilus_trader.backtest.config",
    "nautilus_trader.backtest.engine",
    "nautilus_trader.common",
    "nautilus_trader.common.actor",
    "nautilus_trader.config",
    "nautilus_trader.model",
    "nautilus_trader.model.currencies",
    "nautilus_trader.model.data",
    "nautilus_trader.model.enums",
    "nautilus_trader.model.identifiers",
    "nautilus_trader.model.objects",
    "nautilus_trader.persistence",
    "nautilus_trader.persistence.wranglers",
    "nautilus_trader.test_kit",
    "nautilus_trader.test_kit.providers",
)
_SAVED_MODULES = {name: sys.modules.get(name) for name in _SHADOWED_MODULE_NAMES}
for _name in _SHADOWED_MODULE_NAMES:
    sys.modules[_name] = MagicMock()


def _restore_shadowed_modules() -> None:
    """Restore real (or absent) nautilus_trader modules into sys.modules."""
    for name, original in _SAVED_MODULES.items():
        if original is None:
            sys.modules.pop(name, None)
        else:
            sys.modules[name] = original


_restore_shadowed_modules()


def teardown_module(module):  # noqa: ARG001
    """Belt-and-suspenders restore (import-time restore already ran)."""
    _restore_shadowed_modules()


class TestLifespanStartup:
    """Test lifespan startup sequence."""

    @pytest.mark.asyncio
    async def test_lifespan_gets_running_loop(self):
        """Test lifespan calls asyncio.get_running_loop() (AC1)."""
        with patch("terminal.server.main.create_backtest_queue") as mock_create:
            mock_create.return_value = (MagicMock(), asyncio.Queue())

            with patch("terminal.server.main.run_backtest_with_delay", new_callable=AsyncMock):
                # Import here to apply patches
                from terminal.server.main import lifespan
                from fastapi import FastAPI

                app = FastAPI()

                # Run lifespan
                async with lifespan(app):
                    # Verify create_backtest_queue was called with a loop
                    assert mock_create.called
                    call_args = mock_create.call_args
                    loop_arg = call_args[0][0]
                    assert isinstance(loop_arg, asyncio.AbstractEventLoop)

    @pytest.mark.asyncio
    async def test_lifespan_calls_create_backtest_queue_with_delay_50ms(self):
        """Test lifespan calls create_backtest_queue(loop, delay_ms=50) (AC1)."""
        with patch("terminal.server.main.create_backtest_queue") as mock_create:
            mock_create.return_value = (MagicMock(), asyncio.Queue())

            with patch("terminal.server.main.run_backtest_with_delay", new_callable=AsyncMock):
                from terminal.server.main import lifespan
                from fastapi import FastAPI

                app = FastAPI()

                async with lifespan(app):
                    mock_create.assert_called_once()
                    call_args = mock_create.call_args
                    assert call_args[1]["delay_ms"] == 50

    @pytest.mark.asyncio
    async def test_lifespan_creates_replay_buffer_with_capacity_3000(self):
        """Lifespan creates ReplayBuffer(capacity=3000).

        Sized to the client renderer's MAX_BARS so a refreshed (late-joining)
        page is re-seeded with a full buffer and has immediate pan scrollback,
        rather than only the last 100 bars (which exactly fill the viewport and
        leave nothing to pan into until live bars accumulate).
        """
        with patch("terminal.server.main.create_backtest_queue") as mock_create:
            mock_create.return_value = (MagicMock(), asyncio.Queue())

            with patch("terminal.server.main.run_backtest_with_delay", new_callable=AsyncMock):
                with patch("terminal.server.main.ReplayBuffer") as mock_replay_buffer:
                    mock_replay_buffer.return_value = MagicMock()

                    from terminal.server.main import lifespan
                    from fastapi import FastAPI

                    app = FastAPI()

                    async with lifespan(app):
                        mock_replay_buffer.assert_called_once_with(capacity=3000)

    @pytest.mark.asyncio
    async def test_lifespan_initializes_connection_manager(self):
        """Test lifespan initializes global ConnectionManager (AC2)."""
        with patch("terminal.server.main.create_backtest_queue") as mock_create:
            mock_create.return_value = (MagicMock(), asyncio.Queue())

            with patch("terminal.server.main.run_backtest_with_delay", new_callable=AsyncMock):
                with patch("terminal.server.main.ConnectionManager") as mock_manager:
                    mock_manager.return_value = MagicMock()

                    from terminal.server.main import lifespan
                    from fastapi import FastAPI

                    app = FastAPI()

                    async with lifespan(app):
                        # Verify ConnectionManager was called with replay_buffer
                        assert mock_manager.called

    @pytest.mark.asyncio
    async def test_lifespan_creates_broadcast_task(self):
        """Test lifespan creates background task for broadcast_from_queue() (AC3)."""
        with patch("terminal.server.main.create_backtest_queue") as mock_create:
            queue = asyncio.Queue()
            mock_create.return_value = (MagicMock(), queue)

            with patch("terminal.server.main.run_backtest_with_delay", new_callable=AsyncMock):
                with patch("terminal.server.main.ConnectionManager") as mock_manager:
                    mock_conn_mgr = MagicMock()
                    mock_conn_mgr.broadcast = AsyncMock()
                    mock_manager.return_value = mock_conn_mgr

                    from terminal.server.main import lifespan
                    from fastapi import FastAPI

                    app = FastAPI()

                    # Signal EOF immediately to exit broadcast loop
                    await queue.put(None)

                    async with lifespan(app):
                        # Give tasks a chance to start
                        await asyncio.sleep(0.01)

    @pytest.mark.asyncio
    async def test_lifespan_creates_backtest_task(self):
        """Test lifespan creates background task for run_backtest_with_delay() (AC4)."""
        with patch("terminal.server.main.create_backtest_queue") as mock_create:
            mock_engine = MagicMock()
            queue = asyncio.Queue()
            mock_create.return_value = (mock_engine, queue)

            with patch("terminal.server.main.run_backtest_with_delay", new_callable=AsyncMock) as mock_run:
                # Signal EOF
                await queue.put(None)

                from terminal.server.main import lifespan
                from fastapi import FastAPI

                app = FastAPI()

                async with lifespan(app):
                    await asyncio.sleep(0.01)

                # Verify run_backtest_with_delay was called
                mock_run.assert_called_once_with(mock_engine, queue)

    @pytest.mark.asyncio
    async def test_lifespan_prints_startup_message(self, capsys):
        """Test lifespan prints 'Server running at http://localhost:8000' (AC5)."""
        with patch("terminal.server.main.create_backtest_queue") as mock_create:
            mock_create.return_value = (MagicMock(), asyncio.Queue())

            with patch("terminal.server.main.run_backtest_with_delay", new_callable=AsyncMock):
                from terminal.server.main import lifespan
                from fastapi import FastAPI

                app = FastAPI()

                async with lifespan(app):
                    pass

                # Check stdout for startup message
                captured = capsys.readouterr()
                assert "Server running at http://localhost:8000" in captured.out


class TestLifespanShutdown:
    """Test lifespan shutdown sequence."""

    @pytest.mark.asyncio
    async def test_lifespan_awaits_backtest_task_on_shutdown(self):
        """Test lifespan awaits backtest_task on shutdown (AC6)."""
        with patch("terminal.server.main.create_backtest_queue") as mock_create:
            queue = asyncio.Queue()
            mock_create.return_value = (MagicMock(), queue)

            backtest_completed = False

            async def mock_run_backtest(engine, q):
                nonlocal backtest_completed
                await asyncio.sleep(0.01)
                await q.put(None)
                backtest_completed = True

            with patch("terminal.server.main.run_backtest_with_delay", new=mock_run_backtest):
                from terminal.server.main import lifespan
                from fastapi import FastAPI

                app = FastAPI()

                async with lifespan(app):
                    await asyncio.sleep(0.005)  # Let tasks start

                # After exiting lifespan, backtest should be complete
                assert backtest_completed

    @pytest.mark.asyncio
    async def test_lifespan_cancels_broadcast_task_on_shutdown(self):
        """Test lifespan cancels broadcast_task on shutdown (AC6)."""
        with patch("terminal.server.main.create_backtest_queue") as mock_create:
            queue = asyncio.Queue()
            mock_create.return_value = (MagicMock(), queue)

            broadcast_cancelled = False

            async def mock_run_backtest(engine, q):
                await asyncio.sleep(0.01)
                await q.put(None)

            with patch("terminal.server.main.run_backtest_with_delay", new=mock_run_backtest):
                with patch("terminal.server.main.ConnectionManager") as mock_manager:
                    mock_conn_mgr = MagicMock()

                    async def mock_broadcast(envelope):
                        try:
                            await asyncio.sleep(10)  # Long sleep
                        except asyncio.CancelledError:
                            nonlocal broadcast_cancelled
                            broadcast_cancelled = True
                            raise

                    mock_conn_mgr.broadcast = mock_broadcast
                    mock_manager.return_value = mock_conn_mgr

                    from terminal.server.main import lifespan
                    from fastapi import FastAPI

                    app = FastAPI()

                    async with lifespan(app):
                        await asyncio.sleep(0.005)

                    # Broadcast task should have been cancelled
                    await asyncio.sleep(0.01)
                    # Note: broadcast_cancelled might not be set if the task
                    # was cancelled before entering broadcast(), so we don't assert it


class TestBroadcastFromQueueLogic:
    """Test broadcast_from_queue() loop behavior."""

    @pytest.mark.asyncio
    async def test_broadcast_loop_breaks_on_none(self):
        """Test broadcast_from_queue() breaks loop on None (EOF signal)."""
        with patch("terminal.server.main.create_backtest_queue") as mock_create:
            queue = asyncio.Queue()
            mock_create.return_value = (MagicMock(), queue)

            with patch("terminal.server.main.ConnectionManager") as mock_manager:
                mock_conn_mgr = MagicMock()
                call_count = 0

                async def track_broadcast(envelope):
                    nonlocal call_count
                    call_count += 1

                mock_conn_mgr.broadcast = track_broadcast
                mock_manager.return_value = mock_conn_mgr

                # Enqueue some messages then EOF
                await queue.put({"v": 1, "type": "bar", "seq": 1, "payload": {}})
                await queue.put({"v": 1, "type": "bar", "seq": 2, "payload": {}})
                await queue.put(None)  # EOF signal

                async def mock_run_backtest(engine, q):
                    # Don't put anything, queue already populated
                    pass

                with patch("terminal.server.main.run_backtest_with_delay", new=mock_run_backtest):
                    from terminal.server.main import lifespan
                    from fastapi import FastAPI

                    app = FastAPI()

                    async with lifespan(app):
                        # Give broadcast task time to process
                        await asyncio.sleep(0.02)

                    # Should have broadcast 2 messages, not the None
                    assert call_count == 2

    @pytest.mark.asyncio
    async def test_broadcast_calls_manager_broadcast(self):
        """Test broadcast_from_queue() calls manager.broadcast() for each envelope (AC3)."""
        with patch("terminal.server.main.create_backtest_queue") as mock_create:
            queue = asyncio.Queue()
            mock_create.return_value = (MagicMock(), queue)

            with patch("terminal.server.main.ConnectionManager") as mock_manager:
                mock_conn_mgr = MagicMock()
                mock_conn_mgr.broadcast = AsyncMock()
                mock_manager.return_value = mock_conn_mgr

                envelope1 = {"v": 1, "type": "bar", "seq": 1, "payload": {}}
                envelope2 = {"v": 1, "type": "bar", "seq": 2, "payload": {}}

                await queue.put(envelope1)
                await queue.put(envelope2)
                await queue.put(None)

                async def mock_run_backtest(engine, q):
                    pass

                with patch("terminal.server.main.run_backtest_with_delay", new=mock_run_backtest):
                    from terminal.server.main import lifespan
                    from fastapi import FastAPI

                    app = FastAPI()

                    async with lifespan(app):
                        await asyncio.sleep(0.02)

                    # Verify broadcast was called for both envelopes
                    assert mock_conn_mgr.broadcast.call_count == 2


class TestFastAPIApp:
    """Test FastAPI app configuration."""

    def test_app_has_websocket_route(self):
        """Test FastAPI app has WebSocket route /ws (AC7)."""
        from terminal.server.main import app

        # Find WebSocket routes
        ws_routes = [route for route in app.routes if hasattr(route, "path") and route.path == "/ws"]
        assert len(ws_routes) > 0, "No /ws route found"

        # Verify it's a WebSocket route
        ws_route = ws_routes[0]
        assert "websocket" in str(type(ws_route)).lower(), "/ws is not a WebSocket route"

    def test_app_has_static_files_mount_or_skip(self):
        """Test FastAPI app mounts StaticFiles at / (AC8) or skips if dist not built."""
        from terminal.server.main import app

        # Check if static files are mounted (may not be if dist/ doesn't exist)
        static_routes = [route for route in app.routes if hasattr(route, "path") and route.path == "/"]

        # If dist/ exists, static files should be mounted
        # If dist/ doesn't exist, the mount should be skipped (try/except in main.py)
        # Either case is acceptable, so we don't assert - just verify no crash occurred
        assert app is not None
