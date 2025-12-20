#!/bin/bash
set -e

# GrokiCAD Worker Deployment Script
# This script helps deploy the Cloudflare Worker to different environments

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Environment (default to development)
ENVIRONMENT=${1:-dev}

# Validate environment
if [[ ! "$ENVIRONMENT" =~ ^(dev|beta|production)$ ]]; then
    echo -e "${RED}Error: Invalid environment '$ENVIRONMENT'${NC}"
    echo "Usage: $0 [dev|beta|production]"
    exit 1
fi

echo -e "${GREEN}Deploying to ${YELLOW}$ENVIRONMENT${GREEN} environment...${NC}"

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
    echo -e "${RED}Error: wrangler CLI is not installed${NC}"
    echo "Install it with: bun install -g wrangler"
    exit 1
fi

# Check if user is logged in
if ! wrangler whoami &> /dev/null; then
    echo -e "${YELLOW}Not logged in to Cloudflare. Running 'wrangler login'...${NC}"
    wrangler login
fi

# Compile TypeScript for worker
echo -e "${GREEN}Compiling TypeScript...${NC}"
bunx tsc -p worker/tsconfig.json --noEmit || {
    echo -e "${RED}TypeScript compilation failed!${NC}"
    exit 1
}

# Deploy to the specified environment
echo -e "${GREEN}Deploying worker to $ENVIRONMENT...${NC}"
if [ "$ENVIRONMENT" = "dev" ]; then
    wrangler deploy --env dev
elif [ "$ENVIRONMENT" = "beta" ]; then
    wrangler deploy --env beta
elif [ "$ENVIRONMENT" = "production" ]; then
    echo -e "${YELLOW}⚠️  Deploying to PRODUCTION!${NC}"
    read -p "Are you sure? (yes/no) " -r
    echo
    if [[ $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
        wrangler deploy --env production
    else
        echo -e "${RED}Deployment cancelled${NC}"
        exit 1
    fi
fi

echo -e "${GREEN}✓ Deployment complete!${NC}"

# Show next steps
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "1. Verify secrets are set (see scripts/setup-secrets.sh)"
echo "2. Test the deployed worker"
if [ "$ENVIRONMENT" = "dev" ]; then
    echo "3. When ready, deploy to beta: $0 beta"
elif [ "$ENVIRONMENT" = "beta" ]; then
    echo "3. When ready, deploy to production: $0 production"
fi

