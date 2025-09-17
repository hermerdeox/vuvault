#!/bin/bash

# VuVault Zero - Ngrok Tunnel Setup Script
# This script starts the Vite dev server and creates an ngrok tunnel

echo "🚀 Starting VuVault Zero with Ngrok Tunnel..."
echo "================================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if ngrok is installed
if ! command -v ngrok &> /dev/null; then
    echo -e "${RED}❌ ngrok is not installed. Please install it first.${NC}"
    echo "Visit: https://ngrok.com/download"
    exit 1
fi

# Check if ngrok is authenticated
if ! ngrok config check &> /dev/null; then
    echo -e "${YELLOW}⚠️  ngrok is not authenticated. Please run:${NC}"
    echo "ngrok config add-authtoken YOUR_AUTH_TOKEN"
    exit 1
fi

# Kill any existing processes on port 80
echo "Checking for processes on port 80..."
if lsof -Pi :80 -sTCP:LISTEN -t >/dev/null ; then
    echo -e "${YELLOW}Port 80 is in use. Attempting to free it...${NC}"
    sudo lsof -Pi :80 -sTCP:LISTEN -t | xargs sudo kill -9 2>/dev/null || true
    sleep 2
fi

# Function to cleanup on exit
cleanup() {
    echo -e "\n${YELLOW}Cleaning up...${NC}"
    # Kill the dev server
    if [ ! -z "$DEV_PID" ]; then
        kill $DEV_PID 2>/dev/null || true
    fi
    # Kill ngrok
    if [ ! -z "$NGROK_PID" ]; then
        kill $NGROK_PID 2>/dev/null || true
    fi
    exit 0
}

# Set up trap to cleanup on script exit
trap cleanup EXIT INT TERM

# Start the Vite dev server on port 80 (requires sudo)
echo -e "${GREEN}Starting Vite dev server on port 80...${NC}"
echo "Note: This requires sudo access for port 80"
cd /Users/cybertouch/Documents/eoxvault/eoxvault-zero

# Start dev server in background with sudo
sudo bun run dev &
DEV_PID=$!

# Wait for dev server to start
echo "Waiting for dev server to start..."
sleep 5

# Check if dev server is running
if ! curl -s http://localhost:80 > /dev/null; then
    echo -e "${RED}❌ Dev server failed to start on port 80${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Dev server is running on port 80${NC}"

# Start ngrok tunnel with custom domain
echo -e "${GREEN}Starting ngrok tunnel...${NC}"
ngrok http --url=vuvault.ngrok.io 80 &
NGROK_PID=$!

# Wait for ngrok to start
sleep 3

# Display tunnel information
echo "================================================"
echo -e "${GREEN}🎉 VuVault Zero is now accessible at:${NC}"
echo -e "${YELLOW}https://vuvault.ngrok.io${NC}"
echo "================================================"
echo ""
echo "Press Ctrl+C to stop the tunnel and dev server"
echo ""

# Keep the script running
wait $NGROK_PID
