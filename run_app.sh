#!/bin/bash
cd "$(dirname "$0")"
source ../venv/bin/activate

# Kill any existing server on Port 8000 to prevent zombie crashes
lsof -ti:8000 | xargs kill -9 2>/dev/null || true

echo "Starting FastAPI Backend on http://localhost:8000"
uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload &
BACKEND_PID=$!

echo "Starting Frontend route..."
# Open the new unified Python server URL
sleep 2
open http://localhost:8000 || xdg-open http://localhost:8000 || start http://localhost:8000

echo "App is running. Press CTRL+C to stop the backend."
wait $BACKEND_PID
