#!/bin/bash
set -e

# GrokiCAD Secrets Setup Script
# This script helps you set up secrets for different environments

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Environment (default to dev)
ENVIRONMENT=${1:-dev}

# Validate environment
if [[ ! "$ENVIRONMENT" =~ ^(dev|beta|production)$ ]]; then
    echo -e "${RED}Error: Invalid environment '$ENVIRONMENT'${NC}"
    echo "Usage: $0 [dev|beta|production]"
    exit 1
fi

echo -e "${GREEN}Setting up secrets for ${YELLOW}$ENVIRONMENT${GREEN} environment...${NC}"
echo ""

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
    echo -e "${RED}Error: wrangler CLI is not installed${NC}"
    echo "Install it with: npm install -g wrangler"
    exit 1
fi

# Check if user is logged in
if ! wrangler whoami &> /dev/null; then
    echo -e "${YELLOW}Not logged in to Cloudflare. Running 'wrangler login'...${NC}"
    wrangler login
fi

echo -e "${BLUE}You will be prompted to enter secrets for the $ENVIRONMENT environment.${NC}"
echo -e "${YELLOW}Note: Secrets are encrypted and stored securely by Cloudflare.${NC}"
echo ""

# Set DigiKey Client ID
echo -e "${GREEN}Setting DIGIKEY_CLIENT_ID...${NC}"
echo "Get this from: https://developer.digikey.com/"
wrangler secret put DIGIKEY_CLIENT_ID --env "$ENVIRONMENT"

# Set DigiKey Client Secret
echo ""
echo -e "${GREEN}Setting DIGIKEY_CLIENT_SECRET...${NC}"
wrangler secret put DIGIKEY_CLIENT_SECRET --env "$ENVIRONMENT"

# Set GitHub Client Secret
echo ""
echo -e "${GREEN}Setting GITHUB_CLIENT_SECRET...${NC}"
echo "Get this from: https://github.com/settings/developers"
wrangler secret put GITHUB_CLIENT_SECRET --env "$ENVIRONMENT"

echo ""
echo -e "${GREEN}✓ All secrets have been set for $ENVIRONMENT!${NC}"
echo ""
echo -e "${YELLOW}To view/manage secrets:${NC}"
echo "  wrangler secret list --env $ENVIRONMENT"
echo ""
echo -e "${YELLOW}To update a secret:${NC}"
echo "  wrangler secret put SECRET_NAME --env $ENVIRONMENT"
echo ""
echo -e "${YELLOW}To delete a secret:${NC}"
echo "  wrangler secret delete SECRET_NAME --env $ENVIRONMENT"

