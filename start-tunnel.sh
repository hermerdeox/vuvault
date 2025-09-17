#!/bin/bash

# VuVault Zero - Simple Ngrok Tunnel Setup (No sudo required)
# This script starts the Vite dev server on port 3005 and creates an ngrok tunnel

echo "🚀 Starting VuVault Zero with Ngrok Tunnel..."
echo "================================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if bun is installed
if ! command -v bun &> /dev/null; then
    echo -e "${RED}❌ bun is not installed. Please install it first.${NC}"
    echo "Visit: https://bun.sh"
    exit 1
fi

# Check if ngrok is installed
if ! command -v ngrok &> /dev/null; then
    echo -e "${RED}❌ ngrok is not installed. Please install it first.${NC}"
    echo "Visit: https://ngrok.com/download"
    exit 1
fi

# Navigate to project directory
cd /Users/cybertouch/Documents/eoxvault/eoxvault-zero

# Function to cleanup on exit
cleanup() {
    echo -e "\n${YELLOW}Cleaning up...${NC}"
    # Kill all background jobs
    jobs -p | xargs kill 2>/dev/null || true
    # Restore original vite config
    if [ -f "vite.config.ts.backup" ]; then
        mv vite.config.ts.backup vite.config.ts
    fi
    exit 0
}

# Set up trap to cleanup on script exit
trap cleanup EXIT INT TERM

# Use the ngrok-optimized config
echo -e "${BLUE}Using ngrok-optimized Vite configuration...${NC}"
cp vite.config.ts vite.config.ts.backup 2>/dev/null || true
cp vite.config.ngrok.ts vite.config.ts

# Kill any existing processes on port 3006
if lsof -Pi :3006 -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo -e "${YELLOW}Port 3006 is in use. Attempting to free it...${NC}"
    lsof -Pi :3006 -sTCP:LISTEN -t | xargs kill -9 2>/dev/null || true
    sleep 2
fi

# Start the Vite dev server
echo -e "${GREEN}Starting Vite dev server on port 3006...${NC}"
bun run dev &
DEV_PID=$!

# Wait for dev server to start
echo "Waiting for dev server to start..."
for i in {1..10}; do
    if curl -s http://localhost:3006 > /dev/null 2>&1; then
        break
    fi
    sleep 1
done

# Check if dev server is running
if ! curl -s http://localhost:3006 > /dev/null 2>&1; then
    echo -e "${RED}❌ Dev server failed to start${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Dev server is running on port 3006${NC}"

# Start ngrok tunnel
echo -e "${GREEN}Starting ngrok tunnel...${NC}"
echo ""

# Try with custom domain first (requires paid plan)
if ngrok http --url=vuvault.ngrok.io 3006 2>/dev/null; then
    echo -e "${GREEN}🎉 Custom domain tunnel created!${NC}"
else
    echo -e "${YELLOW}Custom domain not available. Creating standard tunnel...${NC}"
    # Fallback to standard tunnel
    ngrok http 3006
fi
