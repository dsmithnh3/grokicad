#!/bin/bash
set -e

# GrokiCAD KV Namespace Setup Script
# This script creates KV namespaces for different environments

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Setting up KV namespaces...${NC}"
echo ""

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

echo -e "${YELLOW}Creating KV namespaces for different environments...${NC}"
echo ""

# Create Beta KV namespace
echo -e "${GREEN}Creating Beta KV namespace...${NC}"
wrangler kv namespace create DIGIKEY_SESSIONS --env beta
echo ""

# Create Production KV namespace
echo -e "${GREEN}Creating Production KV namespace...${NC}"
wrangler kv namespace create DIGIKEY_SESSIONS --env production
echo ""

echo -e "${GREEN}✓ KV namespaces created!${NC}"
echo ""
echo -e "${YELLOW}⚠️  IMPORTANT: Update wrangler.toml with the namespace IDs shown above!${NC}"
echo ""
echo "1. Copy the 'id' values from the output above"
echo "2. Open wrangler.toml in your editor"
echo "3. Find the [env.beta.kv_namespaces] and [env.production.kv_namespaces] sections"
echo "4. Replace the placeholder IDs with the actual IDs"
echo "5. Save the file"
echo ""
echo -e "${YELLOW}To list all KV namespaces:${NC}"
echo "  wrangler kv namespace list"

