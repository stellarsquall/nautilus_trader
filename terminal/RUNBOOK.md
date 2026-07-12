# Terminal — Manual Browser Verification Runbook

The automated checks (server pytest, TypeScript build, type-check, Vitest tests, core-isolation) are all
green and captured in [`VERIFICATION.md`](./VERIFICATION.md). The **one remaining
step a human must do** is eyeball the live chart in a browser — an agent can't
watch pixels paint. This runbook is that ~3-minute smoke test.

- **Current Slice:** Slice 5 (Order-Flow Analytics — CVD + delta candles)
- **What you're verifying:** 1-minute **Binance ETHUSDT** candles (aggregated from trade
  ticks, real traded volume) stream progressively over a typed WebSocket envelope using a
  custom HTML5 Canvas renderer — a three-pane layout (price / CVD / volume) with
  delta-colored candles, crisp rendering, axes, last-price line, and no external charting
  dependencies.

---

## 0. Prerequisites (one time)

```bash
# from the repo root — builds the core nautilus_trader uv environment (.venv)
uv sync

# Node 18+ and Python 3.12+ must be on PATH
node --version   # >= 18
python3 --version
```

> **Dependency split:** `uv sync` builds the **core** env (`nautilus_trader`) into
> the repo-root `.venv`. The **bolt-on web deps** (`fastapi`, `uvicorn`, `requests`)
> live in [`server/requirements.txt`](./server/requirements.txt) and are installed
> **for you by `run.sh`** into that same `.venv` — they are deliberately kept out of
> the core `pyproject.toml` so upstream is never modified. You do **not** install
> them by hand.
>
> If you launch and see `ModuleNotFoundError: nautilus_trader`, you skipped `uv sync`
> (or there's no `.venv`). If you see `ModuleNotFoundError: fastapi`/`requests`, you
> ran `uvicorn` by hand instead of via `./run.sh` — use the script.

---

## 1. Launch

```bash
cd terminal
./run.sh
```

`run.sh` will, in order:
1. `cd web && npm install && npm run build` (produces `web/dist/`)
2. install the server web deps into the project `.venv` via
   `uv pip install -r server/requirements.txt`
3. print `Server running at http://localhost:8000`
4. print `Open http://localhost:8000 in your browser`
5. start `uv run --no-sync uvicorn terminal.server.main:app --host 0.0.0.0 --port 8000`

Wait until you see the uvicorn `Application startup complete` line and the
`Server running at http://localhost:8000` message from the app's lifespan.

> Run it from the `terminal/` directory (the `cd` paths inside the script are
> relative to that). Leave this terminal running — it's the server.

---

## 2. Slice 2 — Canvas Renderer Verification

1. Open **http://localhost:8000** in a modern browser (Chrome/Firefox/Edge/Safari).
2. Open **DevTools → Console** (Cmd-Opt-J / Ctrl-Shift-J) *before* or right as the
   page loads, so you catch any errors.

Confirm each of the following (slice 2 canvas acceptance criteria):

| # | Expected | Pass? |
|---|----------|-------|
| A | Full-page canvas chart renders within ~2 seconds | ☐ |
| B | Candlestick bars (green/red OHLC) appear **progressively** (≈50 ms per bar) | ☐ |
| C | **Time axis** (bottom) shows HH:MM labels in UTC | ☐ |
| D | **Price axis** (right) shows formatted prices (ETHUSDT ~2-decimal, e.g. ~423.76) | ☐ |
| E | **Last-price line** visible as a dashed horizontal line with price label | ☐ |
| F | **No TradingView logo** or references visible anywhere | ☐ |
| G | **No** console errors mentioning `WebSocket`, canvas, or rendering | ☐ |
| H | Chart resizes smoothly when browser window is resized | ☐ |

**What "good" looks like:** the chart starts empty, then candles march in left-to-right,
several per second, filling out the ~5 h of Binance ETHUSDT data (~300 1-min bars)
over roughly half a minute. Bars are green (#26a69a) / red (#ef5350) OHLC candles rendered
on a crisp HTML5 canvas with clear axes and a last-price indicator. (Candle color is
**delta-based** by default — see §3c — which can differ from close-vs-open.)
### Quick DevTools sanity (optional)
### Quick DevTools sanity (optional)
In the **Network → WS** tab, click the `/ws` connection → **Messages**. Each frame
should be JSON shaped like:
```json
{"v":1,"type":"bar","seq":1,
 "payload":{"ts_event":1597399260000,"open":423.76,"high":424.10,"low":423.50,"close":423.90,"volume":...,"buy_volume":...,"sell_volume":...,"delta":...}}
```
`seq` increments monotonically; `ts_event` is ms and increases. (These are the exact
invariants `test_websocket.py` asserts, so if the tests pass and frames look like
this, the wire format is correct.)

---

## 3. Slice 3 — Chart Interactions Verification

With the chart streaming, verify navigation. All interactions are **client-only** — the
server and `/ws` protocol are untouched.

| # | Action | Expected | Pass? |
|---|--------|----------|-------|
| I | **Click-drag left** (mouse down on chart, move left, release) | Cursor shows **grab → grabbing**; view pans back to **older** bars. Works even if you release the button **off** the chart | ☐ |
| J | **Click-drag right** back toward the newest bar | View scrolls toward the **tail** | ☐ |
| K | **Two-finger vertical scroll** (or mouse wheel) over the chart | Time axis **zooms smoothly** (fewer / more visible bars) — no stutter | ☐ |
| K2 | **Pinch** (trackpad) over the chart | Time axis **zooms smoothly**, same as vertical scroll | ☐ |
| K3 | **Two-finger horizontal scroll** over the chart | View **pans** through time (scrubs older / newer) | ☐ |
| L | Zoom while pointing at a specific bar | The bar **under the cursor stays under the cursor** (cursor-anchored) | ☐ |
| M | Keep zooming **in** | Zoom **clamps** at min (20 bars) — no runaway single giant candle | ☐ |
| M2 | Keep zooming **out** | Stops when **all available bars fill the width** — no empty padding on the left (capped at the data you have, max 500) | ☐ |
| N | Move the mouse over the chart | **Crosshair** appears: vertical + horizontal lines, price label (y-axis), time label (x-axis), and an **OHLC readout** box for the hovered bar | ☐ |
| O | Move the mouse off the chart | Crosshair **hides** | ☐ |
| P | Fresh load, don't touch anything | Chart **auto-follows** the latest bar (newest bar hugs the **right edge**) as new bars stream in | ☐ |
| Q | Pan away from the tail | A **“Latest”** reset button appears (top-right) | ☐ |
| R | While panned away, let new bars arrive | The view does **NOT** jump — auto-follow is paused | ☐ |
| S | Click **“Latest”** | View snaps to the tail, follow resumes, button hides | ☐ |
| T | Pan / zoom across regions of different price | Y-axis **autoscales to the visible window** (price labels track the bars on screen) | ☐ |

> Mechanism: a pure `ChartViewState` module owns the visible window + follow flag (and
> caps zoom-out at the available bar count); `InteractionController` translates
> mouse/wheel events into pan/zoom — click-drag and horizontal scroll pan (drag listeners
> live on `window` so a gesture survives the pointer leaving the canvas), while pinch and
> vertical scroll do a magnitude-scaled, cursor-anchored zoom (reusing `CoordinateTransform`
> inverse maps). The viewport is **right-anchored** (newest bar at the right edge). A
> separate overlay `<canvas>` renders the crosshair without redrawing the main chart; the
> price axis autoscales from the visible bars each frame.

---

## 3b. Slice 4 — Multi-Pane Layout & Volume Pane Verification

The chart is now composed of stacked panes (price 75% / volume 25%) driven by a shared
time axis. Still **client-only** for rendering; the one server-side change is the replay
buffer capacity (see §4). All slice-2/3 behavior must continue to work.

| # | Action | Expected | Pass? |
|---|--------|----------|-------|
| U1 | Look at the bottom quarter of the chart | A **volume pane** is visible below the price pane, with its own volume axis | ☐ |
| U2 | Inspect the volume bars | Bars are **delta-colored** — green when the candle closed up (close ≥ open), red when it closed down — and rendered **slightly transparent** (supporting layer) | ☐ |
| U3 | **Pan / zoom** the chart (any slice-3 gesture) | Both panes move/zoom **together in lockstep** on the shared time axis | ☐ |
| U4 | Move the mouse over the chart | The **crosshair spans both panes**; the value label reads **price** in the price pane and **volume** in the volume pane | ☐ |
| U5 | Re-run the slice-3 checks (I–T) | All slice-3 interactions still pass unchanged | ☐ |
| U6 | Let the buffer exceed the visible window (>100 bars), then **click-drag** | Pan works **immediately** — no zoom warm-up needed (regression guard for the follow-freeze bug) | ☐ |
| U7 | After bars have accumulated, **refresh the page**, then click-drag | Pan works **immediately** after refresh (page re-seeded with up to 1000 buffered bars) | ☐ |

> Mechanism: `PaneLayout` stacks `CandlestickPane` + `VolumePane` and owns the single
> shared horizontal (time) `CoordinateTransform`; `InteractionController` and the crosshair
> both drive that one transform, so panes stay locked together. Each pane owns its own
> vertical transform (price vs. volume), and the crosshair uses a per-pane value resolver
> for the correct readout. Volume bars are colored by candle direction (not aggressor side
> — that arrives with the slice-5 trade-tick pipeline) at `globalAlpha 0.72`.
>
> **Two fixes folded in with this slice:** (1) the renderer no longer double-updates the
> bar count (`setTotalBars` + `onNewBar`) — that froze `visibleStart` at 0 while following
> once the buffer passed the visible window, silently killing pan (U6); (2) the replay
> buffer was sized up to the client's `MAX_BARS` so a refreshed late-joiner has immediate
> pan scrollback (U7, §4).

---

## 3c. Slice 5 — Order-Flow Analytics (CVD + delta candles) Verification

The feed is now **Binance ETHUSDT trade ticks** (default), aggregated into 1-minute
LAST-INTERNAL bars, so `bar.volume` is **real traded volume** and each bar carries
order-flow fields (`buy_volume` / `sell_volume` / `delta`). The chart is now **three
panes** (price 60% / CVD 20% / volume 20%) on the shared time axis. All slice-2/3/4
behavior must continue to work.

| # | Action | Expected | Pass? |
|---|--------|----------|-------|
| V1 | Look at the whole chart | **Three** stacked panes: price (top), a **CVD line pane** (middle), volume histogram (bottom), all on one time axis | ☐ |
| V2 | Inspect the middle pane | A **cumulative-volume-delta line** (blue) with its own right-side integer axis; it trends up when buying dominates, down when selling dominates | ☐ |
| V3 | Inspect the candle bodies | Candles are **delta-colored by default** — green when the bar's `delta ≥ 0` (net buying), red when `delta < 0` (net selling). This can differ from close-vs-open coloring | ☐ |
| V4 | Find the toggle (top-left) and click it | Button reads **"Color: Delta"**; clicking switches to **"Color: Price"** and candles revert to close-vs-open coloring; clicking again restores delta coloring | ☐ |
| V5 | Move the mouse over the chart | Crosshair spans **all three panes**; the value label reads **price** in the top pane, **integer CVD** in the middle pane, **integer volume** in the bottom pane | ☐ |
| V6 | **Pan / zoom** (any slice-3 gesture) | All three panes move/zoom **together in lockstep** on the shared time axis | ☐ |
| V7 | Re-run the slice-4 checks (U1–U7) and slice-3 checks (I–T) | All prior interactions and the multi-pane behavior still pass unchanged | ☐ |

> Mechanism: the server actor (`bar_streaming_actor.py`) buckets each `TradeTick` by
> aggressor side into the current interval, and on bar close emits an **enriched `bar`**
> envelope (OHLCV + buy/sell/delta) followed by a **`cvd`** envelope (session-cumulative
> delta), sharing the monotonic seq. Subscriptions happen in the actor's `on_start` so the
> INTERNAL aggregator doesn't backfill empty intervals (an OOM guard). Client-side,
> `CanvasCandlestickRenderer` composes a 3-pane `PaneLayout` `[0.6, 0.2, 0.2]`, ingests cvd
> envelopes keyed by `ts_event` (resynced onto bar indices after buffer trims), colors
> candles by delta sign, and adds the delta/price color toggle. Protocol stays **v:1**
> (the new bar fields are additive; `cvd` was already reserved in the `Envelope` union).

---

## 3d. Slice 8 — Footprint Bid/Ask Imbalance Highlighting Verification

This slice adds **bid/ask imbalance highlighting** to the dedicated **Footprint /
Numbers-Bars view** (slice 7). Diagonal imbalances compare each price level's aggressor
volume against the *diagonal* neighbor (ask-side buy at price `P` vs sell at `P − bin_size`;
bid-side sell at `P` vs buy at `P + bin_size`) using a **3.0× ratio** with a
**`MIN_IMBALANCE_VOLUME` = 1.0** noise floor; a run of **≥ 3** consecutive same-side
imbalanced levels is a **stacked** imbalance. All highlighting is **pure client** — no
server or protocol change (the `footprint` envelope already carries `buy`/`sell` per level).

Switch to the **Footprint view** first (the view-toggle button, top-left).

| # | Action | Expected | Pass? |
|---|--------|----------|-------|
| W1 | Enter the Footprint view and find the imbalance toggle | A button at the **top-left** reads **"Imbalance: ON"** (markers on by default); the footprint grid shows per-price buy\|sell numbers with the POC outlined | ☐ |
| W2 | Look for **diagonal** imbalance markers on lopsided levels | A **3px edge strip**: teal **`#26a69a`** on the **right** edge for buy-dominant (ask) imbalances, red **`#ef5350`** on the **left** edge for sell-dominant (bid) imbalances | ☐ |
| W3 | Look for **stacked** imbalance brackets | Where **≥ 3** consecutive same-side imbalances stack, a **4px bracket** spans the full height of the run (teal buy / red sell) | ☐ |
| W4 | Click the **Imbalance** toggle | Button flips to **"Imbalance: OFF"**; all edge strips and brackets **disappear**, while the **delta backgrounds, POC outline, and buy\|sell numbers all remain**. Click again → **"Imbalance: ON"** restores markers | ☐ |
| W5 | Switch back to the **Overview** view | Overview has **no** imbalance toggle and **no** markers (footprint-scoped). Returning to Footprint shows the toggle back at **ON** | ☐ |
| W6 | Find a cell that is **both** POC and imbalanced | The **POC outline**, **delta background**, **volume text**, **and** the imbalance strip are all drawn together (markers coexist with, never replace, existing rendering) | ☐ |

> Mechanism: a pure DOM-free detector (`views/footprintImbalance.ts`) exports
> `calculateDiagonalImbalances(levels, binSize, opts?)` and
> `calculateStackedImbalances(diagonalResults, binSize, minRun?)` plus tunable constants
> `IMBALANCE_RATIO = 3.0`, `MIN_IMBALANCE_VOLUME = 1.0`, `STACKED_MIN = 3`. Adjacency is
> **bin-index** based (`Math.round(price / binSize)`), so sparse/float levels resolve
> without false gaps; an absent diagonal neighbor counts as 0 (ratio `Infinity`).
> `FootprintView.drawFootprintGrid` runs the detector **once per visible bar** (never per
> cell), draws strips and brackets in `delta bg → POC → markers → volume text` order, and
> skips detection when the toggle is OFF. The toggle defaults ON and lives/dies with the
> view (Overview untouched). Protocol stays **v:1** — no server change.

**Isolation gates (must both output `0`):**

```bash
git diff terminal..HEAD -- crates/ nautilus_trader/ | wc -l   # core engine untouched
git diff terminal..HEAD -- terminal/server/ | wc -l           # server untouched (pure client)
```

**Automated gates** (inside `terminal/client/`): `npx tsc --noEmit` exits 0;
`npx vitest run` exits 0 with total passing **> 639**; `npm run build` exits 0. **Never**
build the core engine (no `uv` / `maturin` / `cargo` / `pip -e` on the monorepo) — the
terminal runs against the prebuilt `nautilus_trader` wheel only.

---

## 3e. Slice 9 — Legend Panel Verification

This slice adds a **Legend Panel** to **both** views (Footprint and Overview) with a toggle
button and color-swatch entries for the rendered markers of each view. The panel is
**DOM-based** (overlaid on the canvas) and **view-scoped** — each view supplies its OWN entries.
Markers are **widened** (imbalance strips 3px → 4px, stacked brackets 4px → 6px) for easier
visual spotting.

Switch to the **Footprint view** first (the view-toggle button, top-left). Then look for
the new **"Legend: OFF"** text toggle (top-left area, below the view/imbalance toggles).

| # | Action | Expected | Pass? |
|---|--------|----------|-------|
| X1 | Find the **Legend: OFF** toggle (top-left) | A small white button with `1px #cccccc` border reads **"Legend: OFF"** — the legend panel is **hidden by default** | ☐ |
| X2 | Click the **Legend: OFF** toggle | A floating panel appears (bottom-right, `rgba(255,255,255,0.9)` background), and the button reads **"Legend: ON"** | ☐ |
| X3 | Inspect the Footprint panel entries | **6** rows, each with a color swatch (`16×14px`) and label: **Buy Dominant**, **Sell Dominant**, **POC**, **Buy Imbalance**, **Sell Imbalance**, **Stacked Run** | ☐ |
| X4 | Check the swatch kinds | **Buy/Sell Dominant**: solid `fill` swatch, teal `#26a69a` / red `#ef5350`. **POC**: `outline` (hollow, 2px orange `#ff9800` border). **Buy Imbalance**: `rightStrip` (gradient, solid teal `#26a69a` right edge). **Sell Imbalance**: `leftStrip` (gradient, solid red `#ef5350` left edge). **Stacked Run**: `bracket` (4px teal `#26a69a` left border) | ☐ |
| X5 | Check the swatch colors match rendered markers | Teal `#26a69a` swatches match the buy-dominant cell fills, imbalance strips, and stacked brackets. Red `#ef5350` swatches match the sell-dominant fills and sell-imbalance strips. Orange `#ff9800` POC swatch matches the POC outline | ☐ |
| X6 | Click the **Legend: ON** toggle | Panel **hides**, button reads **"Legend: OFF"** | ☐ |
| X7 | Switch to the **Overview** view (top-left toggle) | A **"Legend: OFF"** toggle is present (top-left); clicking it shows a bottom-right panel with **8** rows: **Delta Up** (teal fill), **Delta Down** (red fill), **CVD Line** (indigo `#3f51b5` line), **Volume Up** (teal fill), **Volume Down** (red fill), **VP Buy** (teal fill), **VP Sell** (red fill), **POC** (orange `#ff9800` **filled dot**) | ☐ |
| X8 | Check Overview swatches match rendered marks | The indigo **CVD Line** swatch matches the CVD pane line; teal/red **Delta** + **Volume** + **VP** swatches match the delta candles, volume bars, and volume-profile bars; the orange **POC dot** matches the filled orange dot on the Volume Profile (max-volume price level, right edge) — note this is the *volume-profile* POC (a dot), distinct from the Footprint per-bar POC (an outline) | ☐ |
| X9 | Switch back to **Footprint** view | The **Legend: OFF** toggle reappears (panel defaults hidden per view re-mount) | ☐ |
| X10 | Compare marker widths with slice 8 | Imbalance edge strips are **4px** wide (previously 3px); stacked brackets are **6px** wide (previously 4px) — visually wider than earlier imbalance markers from slice 8 | ☐ |

> Mechanism: `LegendPanel` (DOM class in `ui/LegendPanel.ts`) creates a toggle button
> (top-left, `top:86px left:8px`) and a floating `<div>` panel (bottom-right) with per-entry
> flex rows. Each entry's `kind` drives the swatch CSS: `fill` → background, `outline` →
> 2px border, `leftStrip`/`rightStrip` → gradient, `bracket` → 4px left border, `dot` →
> filled circle (border-radius 50%).
> **Both** views mount a panel with `defaultVisible: false` via their own `getLegendEntries()`:
> `FootprintView` returns 6 footprint entries; `OverviewView` returns 8 overview entries
> (delta/CVD/volume/volume-profile/POC). The marker width constants in `FootprintView` were
> increased from 3 → 4 (`IMBALANCE_MARKER_WIDTH`) and 4 → 6 (`STACKED_BRACKET_WIDTH`).
> Protocol stays **v:1** — no server change.

---

This proves a browser that connects *after* streaming started still sees recent history.

1. **Stop** the server (Ctrl-C in the `run.sh` terminal) and **relaunch** it
   (`./run.sh`), or just leave the first run going and instead:
2. Wait **~5 seconds** after startup (so a batch of bars has been emitted and pushed
   into the replay buffer, capacity **1000**).
3. Open a **new browser tab / incognito window** at http://localhost:8000.

Confirm:

| # | Expected | Pass? |
|---|----------|-------|
| E | The new tab shows bars **immediately** on connect (the buffered backlog), not a blank chart that starts from zero | ☐ |

> Mechanism: on WebSocket connect, `ConnectionManager` replays up to the last 1000
> envelopes from `ReplayBuffer` before live bars resume — so late joiners are never
> staring at an empty chart, and a refreshed page is re-seeded with enough history to
> pan immediately (sized to the client renderer's `MAX_BARS`).

---

## 3f. Slice 10 — Value Area (VAH/VAL) Verification

This slice adds the **Value Area** to the Overview **Volume Profile**: the price range holding
~70% of the visible-range traded volume around the POC, shown as a translucent **band** plus
**VAH/VAL** dashed reference lines, behind a **standalone** `VA: On/Off` toggle (default ON,
independent of the VP-bars toggle). Overview only — the Footprint view is unchanged.

Stay on the **Overview** view. The left button stack (top-left) is now: delta, `VP: On`,
view-toggle, legend, **`VA: On`** (at `top:112`).

| # | Action | Expected | Pass? |
|---|--------|----------|-------|
| Y1 | Find the **`VA: On`** toggle (top-left, below the Legend toggle) | A white button reads **"VA: On"** — value area is **shown by default** | ☐ |
| Y2 | Look at the Volume Profile (right side) | A **translucent slate band** spans a contiguous price range around the POC dot, with **dashed grey horizontal lines** at its top (**VAH**) and bottom (**VAL**) edges | ☐ |
| Y3 | Sanity-check the range | VAL ≤ POC (orange dot) ≤ VAH; the band covers roughly the densest ~70% of the profile bars | ☐ |
| Y4 | Click **`VA: On`** → **`VA: Off`** | The band + VAH/VAL lines **disappear**; the VP bars + POC dot remain | ☐ |
| Y5 | With VA off, click **`VP: On`** → **`VP: Off`** | The bars + POC dot disappear; the chart shows no profile at all (both off = overlay cleared) | ☐ |
| Y6 | Turn **`VA: Off`** → **`VA: On`** (VP still off) | The **band + VAH/VAL lines reappear with NO bars and NO POC dot** (the two toggles are independent) | ☐ |
| Y7 | Turn **`VP: Off`** → **`VP: On`** | Bars + POC dot come back alongside the value area | ☐ |
| Y8 | Open the **Legend** (bottom-right) | Two new rows: **Value Area (VAH/VAL)** — a composite swatch showing a light band with dashed top/bottom edges (mirroring the on-chart band + VAH/VAL lines) — and **Current Price** — a dark dashed line swatch matching the last-price line — 10 entries total | ☐ |

> Mechanism: pure `chart/valueArea.ts` (`calculateValueArea`, `VALUE_AREA_PCT=0.70`) expands
> outward from the POC adding the larger-volume neighbor until ≥70% of volume, guaranteeing
> VAL ≤ POC ≤ VAH. `VolumeProfileOverlay` gains independent `barsVisible` / `valueAreaVisible`
> flags: `render()` draws band → bars → VAH/VAL lines → POC, gating bars+POC on `barsVisible`
> and the band+lines on `valueAreaVisible`. The renderer draws the overlay when EITHER toggle
> is on and clears it only when BOTH are off. Colors: band `rgba(120,123,134,0.12)`, lines
> `#787b86`. Protocol stays **v:1** — no server change.

---

## 5. Shut down

- `Ctrl-C` in the `run.sh` terminal stops uvicorn and the backtest task.
- Nothing else to clean up — no external services, no DB.

---

## 6. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `ModuleNotFoundError: nautilus_trader` | No repo-root `.venv`, or it lacks the core — run `uv sync` from the repo root first (§0). |
| `ModuleNotFoundError: fastapi` / `requests` | You launched `uvicorn` by hand. Use `./run.sh`, which installs `server/requirements.txt` into the `.venv` and launches via `uv run --no-sync`. |
| `ERROR: no .venv found ... run 'uv sync'` (from run.sh) | Run `uv sync` at the repo root, then re-run `./run.sh`. |
| Browser shows a blank page, `404` on `/` | `web/dist/` wasn't built — check the `npm run build` output in the `run.sh` log; rerun `cd terminal/client && npm run build`. |
| Chart container error in console (`chart-container element not found`) | Stale `dist/` — rebuild the terminal (`npm run build`) so `index.html` matches `main.ts`. |
| Console shows `WebSocket connection ... failed` | Server didn't start (see the `run.sh` terminal) or port 8000 is taken — free it or change the port in `run.sh` **and** it'll still be same-origin, so no client change needed. |
| Chart renders but **no** bars ever appear | Backtest produced no bars — confirm the trade-tick dataset is present at `tests/test_data/binance/ethusdt-trades.csv` (default) or `tests/test_data/binance/btcusdt-trades.parquet`; check the server log for a backtest error. |
| Bars appear all at once with no delay | `delay_ms` in `create_backtest_queue` was set to 0; default is 50 ms. |
| Port 8000 already in use | `lsof -ti:8000 | xargs kill`, or edit the `--port` in `terminal/run.sh`. |

---

## 7. Sign-off

When the slice-2 canvas checks (A–H) **and** the slice-3 interaction checks (I–T) **and**
the slice-4 multi-pane checks (U1–U7) **and** the slice-5 order-flow checks (V1–V7) **and**
the slice-8 imbalance checks (W1–W6) **and** the slice-9 legend checks (X1–X10) **and** the slice-10 value-area checks (Y1–Y8) **and**
the slice-11 linked-viewport checks (Z1–Z12) **and**
the late-joiner test (E) are confirmed, the terminal is verified end-to-end.

**Slice 9 (legend panel) sign-off:**
- Verified by: user + assistant (paired)   Date: 2026-07-11   Browser / OS: Chrome / macOS
- Legend checks: X1 ☑ X2 ☑ X3 ☑ X4 ☑ X5 ☑ X6 ☑ X7 ☑ X8 ☑ X9 ☑ X10 ☑

**Slice 10 (value area VAH/VAL) sign-off:**
- Verified by: user + assistant (paired)   Date: 2026-07-11   Browser / OS: Chrome / macOS
- Value-area checks: Y1 ☑ Y2 ☑ Y3 ☑ Y4 ☑ Y5 ☑ Y6 ☑ Y7 ☑ Y8 ☑

**Slice 11 (linked viewport persistence) sign-off:**
- Verified by: user + assistant (paired)   Date: 2026-07-12   Browser / OS: Chrome / macOS
- Linked-viewport checks: Z1 ☑ Z2 ☑ Z3 ☑ Z4 ☑ Z5 ☑ Z6 ☑ Z7 ☑ Z8 ☑ Z9 ☑ Z10 ☑ Z11 ☑ Z12 ☑

---

## 3g. Slice 11 — Linked Viewport Persistence Verification

This slice adds persistent, time-linked viewport state to the NautilusTrader terminal.
When switching between Overview and Footprint views, the viewport remains anchored at the same
point in time (the right-edge bar's `ts_event`). A **"Link Views"** toggle (default ON) allows
users to switch to independent mode where each view remembers its own scroll position.
All behavior is **pure client** under `terminal/client/`.

| # | Action | Expected | Pass? |
|---|--------|----------|-------|
| Z1 | Load the chart (Overview, default) | The chart auto-follows the latest bar (newest bar at right edge) | ☐ |
| Z2 | Pan to a **historical** position, then click the **Footprint** view-toggle | Footprint opens at the **same point in time** as Overview's right-edge bar (linked mode) | ☐ |
| Z3 | Pan Footprint to a different time, then switch back to **Overview** | **Linked mode:** Overview opens at **Footprint's** time — the shared anchor follows whichever view you just left (both views track the same moment) | ☐ |
| Z4 | Find the **Link: On** toggle top-left (Overview: `top:138px left:8px`, Footprint: `top:110px left:64px`) | Button reads **"Link: On"** (default) | ☐ |
| Z5 | Click **"Link: On"** → **"Link: Off"** | Toggle flips; subsequent view switches now restore **each view's own** remembered state (independent mode) | ☐ |
| Z6 | In independent mode, pan Overview, switch to Footprint, pan Footprint to a different position, switch back | Each view remembers its **own** last position (not shared) | ☐ |
| Z7 | With no prior state (first load, never switched), click **Footprint** | Footprint opens at **latest** (default followLatest=true) | ☐ |
| Z8 | Pan so far that the anchor bar has rolled off the buffer, then switch views | No crash — viewport clamps to nearest valid position (oldest or latest) | ☐ |
| Z9 | Set **followLatest=true** via state restoration with any anchor | View positions at the **latest** bar regardless of the provided anchor | ☐ |
| Z12 | Toggle **Color/VP/VA** (Overview) and **Imbalance/Legend**, switch views, switch back | Each view's **toggle states persist** — Overview restores Color/VP/VA/Legend, Footprint restores Imbalance/Legend (per-view, never linked) | ☐ |
| Z11 | **Zoom in** on Overview (wheel), switch to Footprint, switch back to Overview | Overview restores its **zoom level** too (visible bar count is remembered per-view, not reset to default) | ☐ |
| Z10 | Re-run the slice-3/4/5/8/9/10 checks (I–T, U1–U7, V1–V7, W1–W6, X1–X10, Y1–Y8) | All prior interactions and views still pass unchanged | ☐ |

> Mechanism: `ChartView` interface exports `ViewportState` (`anchorTsEvent: number|null`,
> `followLatest: boolean`). Each view (`OverviewView` via `CanvasCandlestickRenderer`,
> `FootprintView`) implements `getViewportState()` and `restoreViewportState(state)` using
> binary search on the bars array to translate between `ts_event` and bar index.
> `ViewManager` orchestrates the capture/restore with a `linkViews` flag (default `true`):
> in linked mode, the outgoing view's state goes to `sharedAnchor` and the incoming view
> restores from it; in independent mode, each view persists/restores its own state.
> `LinkToggleButton` provides the On/Off toggle at view-specific positions.
> Protocol stays **v:1** — no server change; core engine and server untouched.

**Isolation gates (must both output `0`):**

```bash
git diff terminal..HEAD -- crates/ nautilus_trader/ | wc -l   # core engine untouched
git diff terminal..HEAD -- terminal/server/ | wc -l           # server untouched (pure client)
```

**Automated gates** (inside `terminal/client/`): `npx tsc --noEmit` exits 0;
`npx vitest run` exits 0 with total passing **> 752**; `npm run build` exits 0.

---

**Notes:** Pure-client DOM-based legend panel on the Footprint view — 6 entries (Buy/Sell
Dominant fill, POC outline, Buy/Sell Imbalance strips, Stacked Run bracket) with matching
teal `#26a69a` / red `#ef5350` / orange `#ff9800` swatches. Toggle default OFF, per-view
scoping (Overview returns 0 entries). Markers widened: `IMBALANCE_MARKER_WIDTH` 3px → 4px,
`STACKED_BRACKET_WIDTH` 4px → 6px. Both isolation gates 0 (core and server untouched);
`tsc` 0, `vitest` passed, `vite build` green.

**Slice 8 (footprint bid/ask imbalance highlighting) sign-off:**
- Verified by: user + assistant (paired)   Date: 2026-07-10   Browser / OS: Chrome / macOS
- Imbalance checks: W1 ☑ W2 ☑ W3 ☑ W4 ☑ W5 ☑ W6 ☑

**Notes:** Pure-client slice on the Footprint view — diagonal 3px edge strips (teal buy /
red sell) + 4px stacked brackets, driven by a DOM-free detector module
(`views/footprintImbalance.ts`; `IMBALANCE_RATIO = 3.0`, `MIN_IMBALANCE_VOLUME = 1.0`,
`STACKED_MIN = 3`), with a footprint-scoped **Imbalance: ON/OFF** toggle (default ON).
Both isolation gates 0 (core and server untouched); `tsc` 0, `vitest` 686 passed (31
files), `vite build` green.

**Slice 5 (order-flow analytics — CVD + delta candles) sign-off:**
- Verified by: user + assistant (paired)   Date: 2026-07-07   Browser / OS: Chrome / macOS
- Order-flow checks: V1 ☑ V2 ☑ V3 ☑ V4 ☑ V5 ☑ V6 ☑ V7 ☑

**Notes:** Verified from a live run on the Binance ETHUSDT feed. Three panes (price 60% /
CVD line 20% / volume 20%) on the shared time axis; cumulative-delta line with integer
axis; candles delta-colored by default with a working "Color: Delta" ↔ "Color: Price"
toggle; crosshair readout per pane (price / integer CVD / integer volume); pan/zoom locks
all three panes; slice-3 (I–T) and slice-4 (U1–U7) behavior intact. Automated gates:
server `pytest` 80 passed; client `tsc --noEmit` 0 errors, `vitest` 354 passed, `vite
build` green; core isolation `git diff terminal..HEAD -- crates/ nautilus_trader/` = 0
lines. Core (`crates/`, `nautilus_trader/`) untouched.

**Slice 4 (multi-pane layout + volume pane) sign-off:**
- Verified by: user + assistant (paired)   Date: 2026-07-07   Browser / OS: Chrome / macOS
- Multi-pane checks: U1 ☑ U2 ☑ U3 ☑ U4 ☑ U5 ☑ U6 ☑ U7 ☑

**Notes:** Verified from a live run. Volume pane (75/25 split) with delta-colored,
0.72-alpha bars; pan/zoom and crosshair span both panes in lockstep on a shared time
axis; per-pane crosshair readout (price vs. volume). Two bugs surfaced during sign-off and
were fixed before folding: the follow-freeze pan bug (renderer double-updated the bar
count, freezing `visibleStart` at 0 — diagnosed from live `[drag-diag]` console traces)
and the after-refresh dead-pan (replay buffer 100 → 1000, matching client `MAX_BARS`).
Core (`crates/`, `nautilus_trader/`) untouched; the only server change is the replay
buffer capacity.

**Slice 3 (chart interactions) sign-off:**
- Verified by: user + assistant (paired)   Date: 2026-07-06   Browser / OS: Chrome / macOS
- Interaction checks: I ☑ J ☑ K ☑ L ☑ M ☑ N ☑ O ☑ P ☑ Q ☑ R ☑ S ☑ T ☑

**Notes:** Verified from a live run after the right-anchor viewport + interaction-polish
pass. Click-drag pan (grab/grabbing cursor, survives leaving the canvas), two-finger
horizontal-scroll pan, pinch + two-finger-vertical smooth cursor-anchored zoom, zoom-out
capped at available bars (fills width, no empty-left padding), right-anchored viewport
(newest bar at right edge), crosshair + OHLC readout, auto-follow with Latest reset, and
visible-window autoscale all confirmed. Client-only — server and `/ws` protocol untouched.

---

### Slice 2 sign-off (recorded)

When all checks (A–H) and late-joiner test (E) are confirmed, slice 2 is fully verified
end-to-end (automated + manual) with the canvas renderer implementation complete.

- Verified by: user + assistant (paired)
- Date: 2026-07-06
- Browser / OS: Chrome / macOS
- Canvas checks: A ☑  B ☑  C ☑  D ☑  E ☑  F ☑  G ☑  H ☑ (ResizeObserver auto-size)
- Late-joiner: E ☑ (mechanism unchanged from slice 1; server/protocol untouched)

**Notes:** The canvas renderer replaces the previous TradingView lightweight-charts implementation
with a custom HTML5 Canvas solution. Visual parity confirmed from a live run: green/red candles with
wicks, time axis (HH:MM UTC), price axis at 5-decimal FX precision (~0.6689–0.6697), dashed
last-price line + label (~0.66948), crisp rendering, and the production bundle dropped from ~164 KB
to ~12 KB with the dependency removed. The only console output during plotting was a browser-extension
`runtime.lastError` message (not the app) — check G passes.

**Interactions deferred by design (not a defect):** pan / wheel-zoom / scroll-back / crosshair were
scoped OUT of slice 2 as optional nice-to-haves. The renderer shows a fixed auto-scrolling window of
the last 100 bars; once the backtest exhausts the dataset it parks on the final 100 bars and the chart
is intentionally static (no mouse handlers wired). Scroll-back through the retained 1000-bar buffer,
zoom, and a crosshair/OHLC readout are the planned **slice 3 (interactivity)** — the `CoordinateTransform`
module already exposes the inverse maps (`xToBarIndex`, `yToPrice`) those features need.

