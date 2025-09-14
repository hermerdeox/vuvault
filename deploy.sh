#!/bin/bash

# Build the project
echo "Building project..."
bun run build

# Check if dist directory exists
if [ ! -d "dist" ]; then
  echo "Error: dist directory not found!"
  exit 1
fi

# Deploy to Cloudflare Pages
echo "Deploying to Cloudflare Pages..."
npx wrangler pages deploy dist --project-name=vuvault-zero --commit-dirty=true

echo "Deployment complete!"