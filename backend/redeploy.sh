#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}=== Backend Redeploy Script ===${NC}"

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

# Step 1: Pull latest changes
echo -e "\n${GREEN}[1/4] Pulling latest changes...${NC}"
git pull

# Step 2: Stop existing backend process
echo -e "\n${GREEN}[2/4] Stopping existing backend...${NC}"
# Find and kill any process running kicad-backend
if pgrep -f "kicad-backend" > /dev/null; then
    echo "Found running kicad-backend process(es), stopping..."
    pkill -f "kicad-backend" || true
    sleep 2
    # Force kill if still running
    if pgrep -f "kicad-backend" > /dev/null; then
        echo "Force killing..."
        pkill -9 -f "kicad-backend" || true
        sleep 1
    fi
    echo "Backend stopped."
else
    echo "No existing backend process found."
fi

# Step 3: Build the backend
echo -e "\n${GREEN}[3/4] Building backend (release mode)...${NC}"
cd "$SCRIPT_DIR"
cargo build --release

# Step 4: Start the backend
echo -e "\n${GREEN}[4/4] Starting backend...${NC}"
nohup ./target/release/kicad-backend > nohup.out 2>&1 &
NEW_PID=$!
sleep 2

# Verify it's running
if ps -p $NEW_PID > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Backend started successfully (PID: $NEW_PID)${NC}"
    echo -e "  Logs: ${SCRIPT_DIR}/nohup.out"
    echo -e "  Port: ${PORT:-8080}"
else
    echo -e "${RED}✗ Backend failed to start. Check nohup.out for errors:${NC}"
    tail -20 nohup.out
    exit 1
fi

echo -e "\n${GREEN}=== Redeploy Complete ===${NC}"

