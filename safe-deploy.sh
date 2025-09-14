#!/bin/bash
# VuVault Zero - Safe Deployment Protocol
# Non-destructive deployment with rollback capability
# Implements gradual feature rollout with monitoring

set -e # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PROJECT_NAME="vuvault-zero"
BACKUP_DIR="backups"
BUILD_DIR="dist"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_PATH="${BACKUP_DIR}/${TIMESTAMP}"

echo -e "${BLUE}🔐 VuVault Zero - Safe Deployment Protocol${NC}"
echo -e "${BLUE}=========================================${NC}"
echo ""

# Step 1: Pre-deployment checks
echo -e "${YELLOW}📋 Step 1: Pre-deployment checks${NC}"

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo -e "${RED}❌ Error: package.json not found. Are you in the project root?${NC}"
    exit 1
fi

# Check for uncommitted changes
if ! git diff-index --quiet HEAD --; then
    echo -e "${YELLOW}⚠️  Warning: You have uncommitted changes${NC}"
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${RED}❌ Deployment cancelled${NC}"
        exit 1
    fi
fi

echo -e "${GREEN}✅ Pre-deployment checks passed${NC}"
echo ""

# Step 2: Create backup of current production build
echo -e "${YELLOW}📦 Step 2: Creating production backup${NC}"

# Create backup directory if it doesn't exist
mkdir -p "${BACKUP_PATH}"

# Backup current dist if it exists
if [ -d "${BUILD_DIR}" ]; then
    cp -r "${BUILD_DIR}" "${BACKUP_PATH}/"
    echo -e "${GREEN}✅ Current build backed up to ${BACKUP_PATH}${NC}"
    
    # Keep only last 5 backups
    BACKUP_COUNT=$(ls -1 ${BACKUP_DIR} | wc -l)
    if [ $BACKUP_COUNT -gt 5 ]; then
        echo "  Cleaning old backups (keeping last 5)..."
        ls -1t ${BACKUP_DIR} | tail -n +6 | xargs -I {} rm -rf ${BACKUP_DIR}/{}
    fi
else
    echo "  No existing build to backup"
fi

# Backup current configuration
cp vite.config.ts "${BACKUP_PATH}/vite.config.ts.backup" 2>/dev/null || true
echo ""

# Step 3: Build with optimizations
echo -e "${YELLOW}🔨 Step 3: Building optimized version${NC}"

# Use optimized config
cp vite.config.optimized.ts vite.config.ts

# Clean and build
echo "  Cleaning old build..."
rm -rf ${BUILD_DIR}

echo "  Building with optimizations..."
if ! bun run build; then
    echo -e "${RED}❌ Build failed!${NC}"
    
    # Restore original config
    if [ -f "${BACKUP_PATH}/vite.config.ts.backup" ]; then
        echo "  Restoring original configuration..."
        cp "${BACKUP_PATH}/vite.config.ts.backup" vite.config.ts
    fi
    
    # Restore previous build if exists
    if [ -d "${BACKUP_PATH}/${BUILD_DIR}" ]; then
        echo "  Restoring previous build..."
        cp -r "${BACKUP_PATH}/${BUILD_DIR}" .
    fi
    
    exit 1
fi

echo -e "${GREEN}✅ Build completed successfully${NC}"
echo ""

# Step 4: Validate build
echo -e "${YELLOW}✅ Step 4: Validating build integrity${NC}"

# Check critical files
CRITICAL_FILES=(
    "${BUILD_DIR}/index.html"
    "${BUILD_DIR}/manifest.webmanifest"
    "${BUILD_DIR}/sw.js"
)

for file in "${CRITICAL_FILES[@]}"; do
    if [ ! -f "$file" ]; then
        echo -e "${RED}❌ Critical file missing: $file${NC}"
        echo "  Rolling back..."
        
        # Restore backup
        if [ -d "${BACKUP_PATH}/${BUILD_DIR}" ]; then
            rm -rf ${BUILD_DIR}
            cp -r "${BACKUP_PATH}/${BUILD_DIR}" .
        fi
        
        exit 1
    fi
done

# Check file sizes
TOTAL_SIZE=$(du -sh ${BUILD_DIR} | cut -f1)
echo "  Total build size: ${TOTAL_SIZE}"

# Check for large files
echo "  Checking for oversized files..."
LARGE_FILES=$(find ${BUILD_DIR} -type f -size +500k 2>/dev/null)
if [ ! -z "$LARGE_FILES" ]; then
    echo -e "${YELLOW}  ⚠️  Warning: Large files detected:${NC}"
    echo "$LARGE_FILES" | while read file; do
        SIZE=$(du -h "$file" | cut -f1)
        echo "    - $file ($SIZE)"
    done
fi

echo -e "${GREEN}✅ Build validation passed${NC}"
echo ""

# Step 5: Generate deployment report
echo -e "${YELLOW}📊 Step 5: Generating deployment report${NC}"

cat > "DEPLOYMENT_${TIMESTAMP}.md" << EOF
# VuVault Zero - Deployment Report
**Date**: $(date)
**Version**: 2.0.0
**Build ID**: ${TIMESTAMP}

## Build Statistics
- Total Size: ${TOTAL_SIZE}
- Files Generated: $(find ${BUILD_DIR} -type f | wc -l)
- Backup Location: ${BACKUP_PATH}

## Feature Flags
\`\`\`javascript
// Enable enhanced features gradually
localStorage.setItem('vuvault_enhanced_auth', 'false');  // Phase 1: Enhanced Auth
localStorage.setItem('vuvault_web_workers', 'false');    // Phase 2: Web Workers
localStorage.setItem('vuvault_import_v2', 'true');       // Phase 3: Import System
\`\`\`

## Rollout Schedule
- **Day 1-3**: 10% users (canary) - Monitor for issues
- **Day 4-7**: 50% users (beta) - Gather feedback
- **Day 8+**: 100% users (stable) - Full rollout

## Rollback Procedure
\`\`\`bash
# If issues are detected, rollback immediately:
cp -r ${BACKUP_PATH}/${BUILD_DIR} ${BUILD_DIR}
cp ${BACKUP_PATH}/vite.config.ts.backup vite.config.ts
\`\`\`

## Monitoring Checklist
- [ ] Check browser console for errors
- [ ] Verify PWA installation works
- [ ] Test import functionality
- [ ] Monitor bundle load times
- [ ] Check memory usage with large vaults
- [ ] Verify encryption/decryption speed

## Performance Metrics
$(if [ -f "dist/stats.html" ]; then echo "Bundle analysis available at: dist/stats.html"; fi)
EOF

echo -e "${GREEN}✅ Deployment report generated${NC}"
echo ""

# Step 6: Deploy to Cloudflare Pages
echo -e "${YELLOW}🚀 Step 6: Deploying to Cloudflare Pages${NC}"

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
    echo -e "${YELLOW}⚠️  Wrangler not found. Installing...${NC}"
    bun add -g wrangler
fi

# Deploy with feature flags disabled by default
echo "  Deploying with feature flags disabled..."
if wrangler pages deploy ${BUILD_DIR} \
    --project-name=${PROJECT_NAME} \
    --compatibility-date=2025-09-01; then
    
    echo -e "${GREEN}✅ Deployment successful!${NC}"
    echo ""
    
    # Step 7: Post-deployment
    echo -e "${BLUE}📋 Post-Deployment Instructions${NC}"
    echo -e "${BLUE}================================${NC}"
    echo ""
    echo "1. Visit your site: https://${PROJECT_NAME}.pages.dev"
    echo ""
    echo "2. Enable features gradually in browser console:"
    echo "   ${YELLOW}localStorage.setItem('vuvault_enhanced_auth', 'true');${NC}"
    echo "   ${YELLOW}localStorage.setItem('vuvault_web_workers', 'true');${NC}"
    echo ""
    echo "3. Monitor for issues using browser DevTools"
    echo ""
    echo "4. If rollback needed, run:"
    echo "   ${YELLOW}./rollback.sh ${TIMESTAMP}${NC}"
    echo ""
    
    # Create rollback script
    cat > "rollback.sh" << 'ROLLBACK'
#!/bin/bash
TIMESTAMP=$1
if [ -z "$TIMESTAMP" ]; then
    echo "Usage: ./rollback.sh TIMESTAMP"
    echo "Available backups:"
    ls -1 backups/
    exit 1
fi

BACKUP_PATH="backups/${TIMESTAMP}"
if [ ! -d "$BACKUP_PATH" ]; then
    echo "Backup not found: $BACKUP_PATH"
    exit 1
fi

echo "Rolling back to ${TIMESTAMP}..."
rm -rf dist
cp -r "${BACKUP_PATH}/dist" .
if [ -f "${BACKUP_PATH}/vite.config.ts.backup" ]; then
    cp "${BACKUP_PATH}/vite.config.ts.backup" vite.config.ts
fi

echo "Redeploying..."
wrangler pages deploy dist --project-name=vuvault-zero

echo "Rollback complete!"
ROLLBACK
    
    chmod +x rollback.sh
    
    echo -e "${GREEN}🎉 Safe deployment complete!${NC}"
    
else
    echo -e "${RED}❌ Deployment failed!${NC}"
    echo "  Check the error above and try again"
    echo "  Your backup is safe at: ${BACKUP_PATH}"
    exit 1
fi

# Step 8: Optional - Generate bundle analysis
if [ "$1" == "--analyze" ]; then
    echo ""
    echo -e "${YELLOW}📊 Generating bundle analysis...${NC}"
    ANALYZE=true bun run build
    echo -e "${GREEN}✅ Analysis available at: dist/stats.html${NC}"
fi

echo ""
echo -e "${BLUE}=========================================${NC}"
echo -e "${BLUE}Deployment completed at $(date)${NC}"
echo -e "${BLUE}=========================================${NC}"
