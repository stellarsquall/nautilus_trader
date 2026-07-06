#!/bin/bash
#
# Launch the NautilusTrader web terminal:
#   1. build the TypeScript/Vite client        -> terminal/client/dist/
#   2. install the server Python deps into the project's uv `.venv`
#      (the same venv that already has a built nautilus_trader)
#   3. start the FastAPI server, which serves the built static files,
#      runs the backtest, and streams bars over the /ws WebSocket
#
# Prerequisite (one time): from the repo root, run `uv sync` to build the
# core nautilus_trader environment. This script adds the bolt-on web deps
# (fastapi, uvicorn, requests) on top of it — without touching core.
#
# Usage: cd terminal && ./run.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"   # .../terminal
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"                     # repo root (has pyproject.toml + .venv)

# 1. Build the client (produces client/dist/ that the server serves at /).
cd "$SCRIPT_DIR/client"
npm install
npm run build

# 2. Install the server's Python deps into the project's uv-managed venv.
#    (nautilus_trader is already there from `uv sync`; this adds the web deps.)
cd "$ROOT_DIR"
if [ ! -d ".venv" ]; then
  echo "ERROR: no .venv found at $ROOT_DIR — run 'uv sync' from the repo root first." >&2
  exit 1
fi
uv pip install -r terminal/server/requirements.txt

# 3. Start the server from the project venv. `--no-sync` prevents uv from
#    re-syncing (which would strip the web deps just installed above).
echo "Server running at http://localhost:8000"
echo "Open http://localhost:8000 in your browser"
exec uv run --no-sync uvicorn terminal.server.main:app --host 0.0.0.0 --port 8000
