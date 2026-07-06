# Slice 1 — Manual Browser Verification Runbook

The automated checks (backend pytest, TypeScript build, core-isolation) are all
green and captured in [`VERIFICATION.md`](./VERIFICATION.md). The **one remaining
step a human must do** is eyeball the live chart in a browser — an agent can't
watch pixels paint. This runbook is that ~3-minute smoke test.

- **Branch:** `feature/7732fe1e-web-frontend-websocket-chart`
- **What you're verifying:** 1-minute AUD/USD candles stream progressively over a
  typed WebSocket envelope, and a late-joining browser instantly gets recent bars
  from the replay buffer.

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
> live in [`backend/requirements.txt`](./backend/requirements.txt) and are installed
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
cd frontend
./run.sh
```

`run.sh` will, in order:
1. `cd web && npm install && npm run build` (produces `web/dist/`)
2. install the backend web deps into the project `.venv` via
   `uv pip install -r backend/requirements.txt`
3. print `Backend running at http://localhost:8000`
4. print `Open http://localhost:8000 in your browser`
5. start `uv run --no-sync uvicorn frontend.backend.main:app --host 0.0.0.0 --port 8000`

Wait until you see the uvicorn `Application startup complete` line and the
`Backend running at http://localhost:8000` message from the app's lifespan.

> Run it from the `frontend/` directory (the `cd` paths inside the script are
> relative to that). Leave this terminal running — it's the server.

---

## 2. Primary check — progressive candles

1. Open **http://localhost:8000** in a modern browser (Chrome/Firefox/Edge/Safari).
2. Open **DevTools → Console** (Cmd-Opt-J / Ctrl-Shift-J) *before* or right as the
   page loads, so you catch any errors.

Confirm each of the following (these are issue-19's acceptance criteria):

| # | Expected | Pass? |
|---|----------|-------|
| A | Chart canvas renders within ~2 seconds | ☐ |
| B | Candlestick bars appear **progressively** — visible gap between bars (≈50 ms each) | ☐ |
| C | At least **10 bars** visible after 5 seconds (you'll actually see far more) | ☐ |
| D | **No** console errors mentioning `WebSocket` or rendering | ☐ |

**What "good" looks like:** the chart starts empty, then candles march in left-to-right,
several per second, filling out the ~29.5 h of AUD/USD data (hundreds of 1-min bars)
over roughly half a minute. Bars are green/red OHLC candles.

### Quick DevTools sanity (optional)
In the **Network → WS** tab, click the `/ws` connection → **Messages**. Each frame
should be JSON shaped like:
```json
{"v":1,"type":"bar","seq":1,
 "payload":{"ts_event":1580395680000,"open":0.67,"high":0.6705,"low":0.6698,"close":0.6702,"volume":...}}
```
`seq` increments monotonically; `ts_event` is ms and increases. (These are the exact
invariants `test_websocket.py` asserts, so if the tests pass and frames look like
this, the wire format is correct.)

---

## 3. Late-joiner check — replay buffer

This proves a browser that connects *after* streaming started still sees recent history.

1. **Stop** the server (Ctrl-C in the `run.sh` terminal) and **relaunch** it
   (`./run.sh`), or just leave the first run going and instead:
2. Wait **~5 seconds** after startup (so a batch of bars has been emitted and pushed
   into the replay buffer, capacity **100**).
3. Open a **new browser tab / incognito window** at http://localhost:8000.

Confirm:

| # | Expected | Pass? |
|---|----------|-------|
| E | The new tab shows bars **immediately** on connect (the buffered backlog), not a blank chart that starts from zero | ☐ |

> Mechanism: on WebSocket connect, `ConnectionManager` replays up to the last 100
> envelopes from `ReplayBuffer` before live bars resume — so late joiners are never
> staring at an empty chart.

---

## 4. Shut down

- `Ctrl-C` in the `run.sh` terminal stops uvicorn and the backtest task.
- Nothing else to clean up — no external services, no DB.

---

## 5. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `ModuleNotFoundError: nautilus_trader` | No repo-root `.venv`, or it lacks the core — run `uv sync` from the repo root first (§0). |
| `ModuleNotFoundError: fastapi` / `requests` | You launched `uvicorn` by hand. Use `./run.sh`, which installs `backend/requirements.txt` into the `.venv` and launches via `uv run --no-sync`. |
| `ERROR: no .venv found ... run 'uv sync'` (from run.sh) | Run `uv sync` at the repo root, then re-run `./run.sh`. |
| Browser shows a blank page, `404` on `/` | `web/dist/` wasn't built — check the `npm run build` output in the `run.sh` log; rerun `cd frontend/web && npm run build`. |
| Chart container error in console (`chart-container element not found`) | Stale `dist/` — rebuild the frontend (`npm run build`) so `index.html` matches `main.ts`. |
| Console shows `WebSocket connection ... failed` | Backend didn't start (see the `run.sh` terminal) or port 8000 is taken — free it or change the port in `run.sh` **and** it'll still be same-origin, so no client change needed. |
| Chart renders but **no** bars ever appear | Backtest produced no bars — confirm the tick dataset is present at `tests/test_data/truefx/audusd-ticks.csv`; check the server log for a backtest error. |
| Bars appear all at once with no delay | `delay_ms` in `create_backtest_queue` was set to 0; default is 50 ms. |
| Port 8000 already in use | `lsof -ti:8000 | xargs kill`, or edit the `--port` in `frontend/run.sh`. |

---

## 6. Sign-off

When A–E are all checked, slice 1 is fully verified end-to-end (automated + manual)
and the last outstanding debt item ("manual browser rendering checks") is closed.

- Verified by: user + assistant (paired)
- Date: 2026-07-06
- Browser / OS: Chrome / macOS
- A ☑  B ☑  C ☑  D ☑  E ☑

**Notes:** Late-joiner replay confirmed in a fresh incognito window (chart appears
instantly from the replay buffer). The only console output during streaming was
(a) `Unchecked runtime.lastError: The message port closed...` — emitted by a
browser **extension**, not the app; and (b) a `favicon.ico 404`, since resolved
by adding an inline SVG favicon. **No WebSocket or rendering errors** — §2-D passes.
