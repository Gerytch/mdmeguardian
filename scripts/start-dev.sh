#!/usr/bin/env bash
# Start backend and frontend in development mode

cd "$(dirname "$0")/.."

# Start backend in background
echo "[MDM] Starting backend on :3000..."
cd backend && npm run start:dev &
BACKEND_PID=$!

# Wait for backend to be ready
echo "[MDM] Waiting for backend..."
for i in {1..30}; do
  if curl -s http://localhost:3000/api/v1/docs > /dev/null 2>&1; then
    echo "[MDM] Backend ready!"
    break
  fi
  sleep 2
done

# Start frontend
echo "[MDM] Starting frontend on :3001..."
cd ../frontend && npm run dev &
FRONTEND_PID=$!

echo
echo "============================================================"
echo " MDM SaaS Running"
echo "  Backend:   http://localhost:3000/api/v1/docs"
echo "  Frontend:  http://localhost:3001"
echo "  Press Ctrl+C to stop both"
echo "============================================================"

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" INT TERM
wait $BACKEND_PID $FRONTEND_PID
