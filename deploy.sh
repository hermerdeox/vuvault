#!/bin/bash

echo "🚀 Starting VuVault Zero deployment..."

# Install dependencies
echo "📦 Installing dependencies..."
bun install

# Build the application
echo "🔨 Building application..."
bun run build

# Run type checking
echo "✅ Type checking..."
bun run type-check

# Deploy to Cloudflare Pages
echo "☁️ Deploying to Cloudflare Pages..."
wrangler pages deploy dist --project-name=vuvault-zero

echo "✅ Deployment complete!"
echo "🔗 Your app is live at: https://vuvault-zero.pages.dev"
