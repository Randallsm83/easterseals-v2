#!/bin/bash
# Deployment script for Easterseals Research v2

set -e

echo "📦 Installing dependencies..."
npm ci

echo "🔨 Building client..."
npm run build:client

echo "🔨 Building server..."
npm run build:server

echo "✅ Build complete!"
echo ""
echo "To start the production server:"
echo "  NODE_ENV=production node server/dist/index.js"
echo ""
echo "Or with PM2:"
echo "  pm2 start server/dist/index.js --name easterseals -e NODE_ENV=production"
