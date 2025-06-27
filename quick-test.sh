#!/bin/bash

# Quick test script for OAuth authentication
# This creates a temporary project for testing

echo "🚀 Quick OAuth Test for Gemini Web Search"
echo ""

# Generate a unique project ID for testing
TEMP_PROJECT_ID="gemini-web-search-test-$(date +%s)"

echo "Creating temporary project for testing: $TEMP_PROJECT_ID"
echo ""

# Export the project ID
export GOOGLE_CLOUD_PROJECT=$TEMP_PROJECT_ID

echo "📋 Using temporary project: $GOOGLE_CLOUD_PROJECT"
echo ""

# Build the project
echo "🔨 Building project..."
npm run build

if [ $? -eq 0 ]; then
    echo "✅ Build successful"
else
    echo "❌ Build failed"
    exit 1
fi

echo ""
echo "🧪 Testing OAuth authentication..."
echo "Note: This will open a browser for Google login"
echo ""

# Test OAuth with the temporary project
USE_OAUTH=true npm run dev:cli -- "test query"

echo ""
echo "📝 Test completed with temporary project: $TEMP_PROJECT_ID"
echo ""
echo "To use OAuth authentication permanently:"
echo "1. Create a real Google Cloud project at: https://console.cloud.google.com/projectcreate"
echo "2. Set: export GOOGLE_CLOUD_PROJECT=your-real-project-id"
echo "3. Run: ./setup-gcp.sh"