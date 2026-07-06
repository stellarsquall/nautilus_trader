# NautilusTrader Terminal

A WebSocket-based candlestick chart terminal for NautilusTrader backtests, architected to support future order-flow visualizations without modifying existing code or message schemas.

## Prerequisites

Before running the terminal, ensure you have the following installed:

- **Python 3.12+** (tested with Python 3.12-3.14)
- **Node.js 18+** (for building the TypeScript client)
- **NautilusTrader** built locally (run `uv sync` in the project root to create the core `.venv`; `run.sh` adds the bolt-on web deps on top)

## Quick Start

Launch the complete terminal stack with a single command:

```bash
cd terminal && ./run.sh
```

This script will:
1. Install the server web dependencies (FastAPI, uvicorn, requests) into the project `.venv` from `server/requirements.txt`
2. Install Node.js dependencies (`npm install` in `client/`)
3. Build the Vite client (`npm run build` in `client/`)
4. Start the FastAPI server (which serves the built static files and runs the backtest)
5. Print the URL to open in your browser: `http://localhost:8000`

Open the URL in a modern browser (Chrome, Firefox, Edge, or Safari) to view the live-updating candlestick chart.

## Architecture

This terminal demonstrates a minimal working slice that establishes the architectural foundation for a future order-flow trading platform. The design enables future enhancements (footprint/Numbers Bars, CVD pane, depth heatmap, trade streaming) without breaking existing code.

### Directory Structure

```
terminal/
├── server/              # Python server (FastAPI + NautilusTrader)
│   ├── main.py          # FastAPI app with lifespan, /ws endpoint
│   ├── backtest.py      # Backtest engine setup and queue creation
│   ├── bar_streaming_actor.py  # Actor that forwards bars to asyncio.Queue
│   ├── websocket.py     # ConnectionManager and broadcast logic
│   ├── replay_buffer.py # FIFO buffer for late-joining clients
│   └── tests/           # Server unit and integration tests
│       └── test_websocket.py
├── client/                 # TypeScript client (Vite + HTML5 Canvas renderer)
│   ├── src/
│   │   ├── main.ts      # WebSocket connection and envelope dispatch
│   │   ├── panes/       # Pane abstraction (CandlestickPane)
│   │   ├── renderers/   # Renderer interface and canvas implementations
│   │   └── types.ts     # TypeScript envelope types
│   ├── index.html       # Chart container div
│   ├── package.json     # Node.js dependencies
│   └── vite.config.ts   # Vite build configuration
├── run.sh               # One-command install and launch script
└── README.md            # This file
```

### WebSocket Envelope Protocol

Every WebSocket frame conforms to a typed, versioned envelope structure:

```json
{
  "v": 1,
  "type": "bar",
  "seq": 42,
  "payload": {
    "ts_event": 1580395680000,
    "open": 0.6706,
    "high": 0.6710,
    "low": 0.6704,
    "close": 0.6708,
    "volume": 123456
  }
}
```

**Field Definitions:**

- `v` (int): Protocol version. Increments only for breaking changes.
- `type` (string): Message type. Currently `"bar"` for candlestick bars. Reserved types: `"trade"`, `"book_delta"`, `"footprint"`, `"cvd"`, `"depth_heatmap"`.
- `seq` (int): Monotonically increasing sequence number. Enables gap detection.
- `payload` (object): Type-specific data. For `type="bar"`, contains OHLCV data with timestamps in milliseconds.

**Key Design Principles:**

- **Extensible without breaking changes**: Adding a new message type (e.g., `type="trade"`) requires zero changes to existing `type="bar"` handling.
- **Version control**: The `v` field enables protocol evolution. Clients can negotiate capabilities.
- **Sequence numbers**: Global counter across all message types enables reliable gap detection in heterogeneous streams.

### Thread-Safe Actor Queue Bridging

The architecture bridges NautilusTrader's synchronous `BacktestEngine` with FastAPI's asynchronous event loop using thread-safe queue operations:

```
┌─────────────────────────────────────────────────────────────────┐
│                    FastAPI Asyncio Event Loop                   │
│  - Runs on main thread                                          │
│  - Handles WebSocket connections (/ws endpoint)                 │
│  - Consumes from asyncio.Queue and broadcasts to clients        │
└─────────────────────────────────────────────────────────────────┘
                           ▲
                           │ call_soon_threadsafe(queue.put_nowait, envelope)
                           │
┌─────────────────────────────────────────────────────────────────┐
│              ThreadPoolExecutor Worker Thread                   │
│  - Runs BacktestEngine.run() (blocking, synchronous)            │
│  - Actor.on_bar() callbacks execute on this thread              │
│  - Actor calls loop.call_soon_threadsafe() to enqueue messages  │
└─────────────────────────────────────────────────────────────────┘
```

**Critical Implementation Details:**

- `BacktestEngine.run()` is a blocking, synchronous call that processes all data in a tight loop.
- The `BarStreamingActor` receives `on_bar()` callbacks on the worker thread.
- Direct calls to `queue.put_nowait()` from the worker thread are NOT thread-safe.
- `loop.call_soon_threadsafe(queue.put_nowait, envelope)` schedules the enqueue operation on the main event loop thread, ensuring thread safety.

### Pane/Renderer Abstraction

The terminal isolates rendering libraries through a clean interface, enabling future custom renderers without modifying the pane abstraction:

```typescript
// Renderer interface (terminal/client/src/renderers/Renderer.ts)
export interface Renderer {
  update(data: unknown): void;
  destroy(): void;
}

// Pane manages a chart area and delegates rendering
class CandlestickPane {
  constructor(private renderer: Renderer) {}

  handleMessage(envelope: Envelope) {
    if (envelope.type === "bar") {
      this.renderer.update(envelope.payload);
    }
  }
}
```

**Benefits:**

- **Pluggable renderers**: The current implementation uses a custom HTML5 Canvas renderer with layered rendering, coordinate transforms, and devicePixelRatio-crisp display. Future renderers (WebGL for footprint, custom visualizations for depth heatmap) implement the same interface.
- **Testability**: Mock renderers enable unit testing of pane logic without heavyweight chart libraries.
- **No leakage**: `CanvasCandlestickRenderer` is encapsulated in `terminal/client/src/renderers/`; the rest of the app depends only on the `Renderer` interface.

### Data Flow

1. **Backtest runs on worker thread**: `BacktestEngine.run()` processes quote ticks and aggregates 1-minute bars.
2. **Actor emits envelopes**: `BarStreamingActor.on_bar()` creates typed envelopes and enqueues via `call_soon_threadsafe`.
3. **Main event loop broadcasts**: The `broadcast_from_queue()` coroutine consumes envelopes and sends to all connected WebSocket clients.
4. **Browser receives and dispatches**: `main.ts` parses envelopes and routes by `type` to the appropriate pane.
5. **Pane validates and renders**: `CandlestickPane` validates OHLC relationships and calls `renderer.update()`.
6. **Renderer updates chart**: `CanvasCandlestickRenderer` uses coordinate transforms to map OHLC data to canvas pixels and renders candlesticks with crisp, high-DPI rendering.

## Extensibility

The architecture is designed for future order-flow visualization features. Adding new capabilities requires minimal changes:

### Adding New Message Types

**Scenario**: Stream trade ticks to the terminal.

**Server changes**:
1. Add `type="trade"` to the actor's type registry.
2. Subscribe to trade ticks in the backtest setup.
3. Implement `on_trade()` callback that creates trade envelopes.

**Client changes**:
1. Add `TradePayload` interface to `types.ts`.
2. Create a `TradePane` class.
3. Add a `case "trade":` handler in `main.ts` dispatch logic.

**No changes required**:
- Existing `type="bar"` handling remains untouched.
- WebSocket infrastructure (envelope parsing, sequence validation) is reused.
- Server `ConnectionManager` and `ReplayBuffer` work unchanged.

**Future message types** (reserved but not implemented):
- `type="trade"`: Individual trade ticks with price, size, aggressor side.
- `type="book_delta"`: Order book updates (add/modify/delete operations).
- `type="footprint"`: Per-price bid/ask volume within each bar (footprint/Numbers Bars).
- `type="cvd"`: Cumulative Volume Delta for CVD pane.
- `type="depth_heatmap"`: Market depth snapshots for heatmap visualization.

### Adding Custom Renderers

**Scenario**: Render footprint (per-price bid/ask volume) using a custom canvas renderer.

**Implementation**:
1. Create `FootprintCanvasRenderer` implementing the `Renderer` interface.
2. Implement `update(data: unknown)` to draw the footprint grid on a `<canvas>` element.
3. Instantiate `FootprintPane` with `new FootprintCanvasRenderer(container)`.
4. Add `case "footprint":` to the dispatch logic in `main.ts`.

**No changes required**:
- `Renderer` interface remains stable.
- `CanvasCandlestickRenderer` continues to work for candlestick bars.
- Pane abstraction is generic and supports any renderer.

## Dataset

The default backtest uses the bundled NautilusTrader dataset:

- **File**: `tests/test_data/truefx/audusd-ticks.csv`
- **Instrument**: AUD/USD
- **Data type**: Quote ticks (~100k ticks)
- **Time range**: 2020-01-30 to 2020-01-31
- **Aggregation**: 1-minute bars via `BarType.from_str("AUD/USD.SIM-1-MINUTE-MID-INTERNAL")`

The `INTERNAL` aggregation source is critical for bars-from-ticks. See `server/backtest.py` for the complete setup.

## Replay Buffer

Late-joining WebSocket clients receive the last 100 bars immediately upon connection, ensuring they see recent history without waiting for new bars. This is implemented via a FIFO `ReplayBuffer` (`collections.deque(maxlen=100)`) that caches envelopes before broadcasting.

**Progressive Chart Population**:
- When the browser connects after backtest start, it receives the replay buffer (last N bars) immediately.
- As the backtest runs, new bars arrive with a configurable playback delay (default 50ms), visibly populating the chart.
- The chart does not flash or reset; bars append smoothly to the existing series.

## Testing

### Server Tests

Run server tests with pytest:

```bash
cd terminal/server
pytest tests/test_websocket.py -v
```

Tests validate:
- Envelope structure (`v`, `type`, `seq` fields)
- OHLC relationships (high ≥ max(open, close), low ≤ min(open, close))
- Timestamp monotonicity
- Sequence number monotonicity
- Timestamp conversion (nanoseconds → milliseconds)

### Client Build

Build the TypeScript client:

```bash
cd terminal/client
npm install
npm run build
```

The build creates a `dist/` directory with optimized static assets served by FastAPI.

## Development

### Modifying the Server

Edit Python files in `terminal/server/`. The server runs with FastAPI's auto-reload enabled during development (via `uvicorn --reload`).

### Modifying the Client

Edit TypeScript files in `terminal/client/src/`. For live development:

```bash
cd terminal/client
npm run dev
```

This starts Vite's dev server with hot module replacement. Note: you must run the server separately for WebSocket connectivity.

## Browser Compatibility

The terminal targets modern evergreen browsers:
- Chrome/Edge (latest 2 versions)
- Firefox (latest 2 versions)
- Safari (latest 2 versions)

No IE11 or legacy browser support.

## License

This terminal follows the NautilusTrader project license. See the main repository README for details.

## Future Work

Planned enhancements (not in current slice):
- **Order-flow visualizations**: Footprint/Numbers Bars, CVD pane, depth heatmap, delta candles.
- **Trade/depth data ingestion**: TradeTick streaming, OrderBookDelta streaming.
- **Playback controls**: Pause/resume, speed adjustment, timeframe switcher.
- **Multiple instruments**: Symbol selection UI, multi-instrument backtests.
- **WebSocket reconnection**: Resume-from-sequence logic for dropped connections.
- **Binary WebSocket frames**: Efficient encoding for high-frequency streams.

## Troubleshooting

### No bars appear in the chart

- Check the browser console for WebSocket errors.
- Verify the server is running at `http://localhost:8000`.
- Ensure the dataset exists: `tests/test_data/truefx/audusd-ticks.csv`.

### "Queue not injected" error in server logs

- This indicates the `BarStreamingActor` did not receive the queue before `engine.run()` was called.
- Verify `actor.set_queue(queue, loop)` is called in `backtest.py` before `engine.run()`.

### WebSocket connection refused

- Ensure the server is running (`./run.sh` or `uvicorn main:app`).
- Check that port 8000 is not blocked by a firewall.
- Verify the terminal WebSocket URL matches the server host (`ws://localhost:8000/ws`).

---

For more details, see the [PRD](../.artifacts/plan/prd.md) and [Architecture](../.artifacts/plan/architecture.md) documents.
