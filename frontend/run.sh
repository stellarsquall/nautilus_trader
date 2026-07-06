#!/bin/bash

# Navigate to web directory, install dependencies, and build
cd frontend/web && npm install && npm run build

# Navigate back to project root for uvicorn
cd ../..

# Print startup messages
echo "Backend running at http://localhost:8000"
echo "Open http://localhost:8000 in your browser"

# Start the FastAPI backend server
uvicorn frontend.backend.main:app --host 0.0.0.0 --port 8000
