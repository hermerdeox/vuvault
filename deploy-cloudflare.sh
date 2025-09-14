#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 VuVault Zero - Cloudflare Pages Deployment${NC}"
echo "================================================"

# Check if bun is installed
if ! command -v bun &> /dev/null; then
    echo -e "${RED}❌ Bun is not installed. Please install from https://bun.sh${NC}"
    exit 1
fi

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
    echo -e "${YELLOW}⚠️  Wrangler not found. Installing...${NC}"
    npm install -g wrangler
fi

# Clean previous build
echo -e "${YELLOW}🧹 Cleaning previous build...${NC}"
rm -rf dist

# Install dependencies
echo -e "${YELLOW}📦 Installing dependencies...${NC}"
bun install

# Type checking
echo -e "${YELLOW}✅ Running type check...${NC}"
bun run type-check || {
    echo -e "${RED}❌ Type checking failed${NC}"
    exit 1
}

# Build the application
echo -e "${YELLOW}🔨 Building application...${NC}"
bun run build || {
    echo -e "${RED}❌ Build failed${NC}"
    exit 1
}

# Copy Cloudflare configuration files to dist
echo -e "${YELLOW}📋 Copying Cloudflare configuration...${NC}"
cp _headers dist/_headers 2>/dev/null || echo "No _headers file found"
cp _redirects dist/_redirects 2>/dev/null || echo "No _redirects file found"

# Check build size
echo -e "${GREEN}📊 Build Statistics:${NC}"
du -sh dist
echo "Files in dist:"
ls -la dist/

# Deploy to Cloudflare Pages
echo -e "${YELLOW}☁️  Deploying to Cloudflare Pages...${NC}"

# Check if user is logged in to Wrangler
wrangler whoami &> /dev/null || {
    echo -e "${YELLOW}Please login to Cloudflare:${NC}"
    wrangler login
}

# Deploy with project name
PROJECT_NAME="vuvault-zero"
echo -e "${YELLOW}Deploying to project: ${PROJECT_NAME}${NC}"

wrangler pages deploy dist --project-name=$PROJECT_NAME || {
    echo -e "${RED}❌ Deployment failed${NC}"
    exit 1
}

echo -e "${GREEN}✅ Deployment complete!${NC}"
echo -e "${GREEN}🔗 Your app is live at: https://${PROJECT_NAME}.pages.dev${NC}"
echo ""
echo -e "${YELLOW}📱 Mobile Installation:${NC}"
echo "1. Open the URL in Safari (iOS) or Chrome (Android)"
echo "2. Tap Share → Add to Home Screen"
echo "3. The app will work offline once installed"
echo ""
echo -e "${YELLOW}🔒 Security Features:${NC}"
echo "✅ ChaCha20-Poly1305 encryption"
echo "✅ WebAuthn biometric authentication"
echo "✅ Zero-knowledge architecture"
echo "✅ All data stored locally"
echo ""
echo -e "${GREEN}🎉 Deployment successful!${NC}"
