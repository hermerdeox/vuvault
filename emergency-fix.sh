#!/bin/bash

echo "🚨 Emergency VuVault Zero Recovery Script"

# Clean everything
echo "Cleaning workspace..."
rm -rf node_modules dist .vite bun.lockb package-lock.json yarn.lock .parcel-cache .turbo

# Install with bun first (using bun instead of npm per workspace rules)
echo "Installing dependencies with bun..."
bun install --force

# Build with detailed error logging
echo "Attempting build..."
bun run build 2>&1 | tee build.log

# Check if build succeeded
if [ -d "dist" ] && [ -f "dist/index.html" ]; then
    echo "✅ Build successful!"
    echo "Starting preview server..."
    bun run preview
else
    echo "❌ Build failed. Check build.log for details"
    echo "Attempting development mode as fallback..."
    bun run dev
fi
