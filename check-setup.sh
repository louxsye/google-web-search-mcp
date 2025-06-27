#!/bin/bash

# Google Cloud Setup Checker for Gemini Web Search MCP
# このスクリプトは設定状況を確認します

echo "🔍 Checking Google Cloud setup for Gemini Web Search MCP..."
echo ""

# gcloudコマンドの存在確認
if command -v gcloud &> /dev/null; then
    echo "✅ gcloud CLI is installed"
    
    # ログイン状態の確認
    if gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q "."; then
        ACTIVE_ACCOUNT=$(gcloud auth list --filter=status:ACTIVE --format="value(account)")
        echo "✅ Logged in as: $ACTIVE_ACCOUNT"
    else
        echo "❌ Not logged in to gcloud"
        echo "   Run: gcloud auth login"
    fi
    
    # プロジェクトの確認
    CURRENT_PROJECT=$(gcloud config get-value project 2>/dev/null)
    if [ -n "$CURRENT_PROJECT" ]; then
        echo "✅ Current project: $CURRENT_PROJECT"
    else
        echo "❌ No project set"
        echo "   Run: gcloud config set project YOUR_PROJECT_ID"
    fi
else
    echo "❌ gcloud CLI is not installed"
    echo "   Install from: https://cloud.google.com/sdk/docs/install"
fi

echo ""

# 環境変数の確認
echo "📋 Environment Variables:"
if [ -n "$GOOGLE_CLOUD_PROJECT" ]; then
    echo "✅ GOOGLE_CLOUD_PROJECT: $GOOGLE_CLOUD_PROJECT"
else
    echo "❌ GOOGLE_CLOUD_PROJECT: not set"
fi

if [ -n "$GOOGLE_API_KEY" ] || [ -n "$GEMINI_API_KEY" ]; then
    echo "✅ API Key: configured"
else
    echo "❌ API Key: not set (GOOGLE_API_KEY or GEMINI_API_KEY)"
fi

if [ -n "$GOOGLE_APPLICATION_CREDENTIALS" ]; then
    echo "✅ Application Credentials: $GOOGLE_APPLICATION_CREDENTIALS"
    if [ -f "$GOOGLE_APPLICATION_CREDENTIALS" ]; then
        echo "   File exists"
    else
        echo "   ❌ File not found"
    fi
else
    echo "❌ GOOGLE_APPLICATION_CREDENTIALS: not set"
fi

echo ""

# OAuth設定の確認
OAUTH_CREDS_PATH="$HOME/.google-web-search/oauth_creds.json"
if [ -f "$OAUTH_CREDS_PATH" ]; then
    echo "✅ OAuth credentials cached: $OAUTH_CREDS_PATH"
else
    echo "❌ OAuth credentials: not cached"
fi

CONFIG_PATH="$HOME/.google-web-search/config.json"
if [ -f "$CONFIG_PATH" ]; then
    echo "✅ Configuration file: $CONFIG_PATH"
    if command -v jq &> /dev/null; then
        PROJECT_ID=$(jq -r '.project_id' "$CONFIG_PATH" 2>/dev/null)
        if [ "$PROJECT_ID" != "null" ] && [ -n "$PROJECT_ID" ]; then
            echo "   Project ID: $PROJECT_ID"
        fi
    fi
else
    echo "❌ Configuration file: not found"
fi

echo ""

# APIの有効化確認（プロジェクトが設定されている場合）
PROJECT_TO_CHECK=${GOOGLE_CLOUD_PROJECT:-$CURRENT_PROJECT}
if [ -n "$PROJECT_TO_CHECK" ] && command -v gcloud &> /dev/null; then
    echo "🔌 API Status for project: $PROJECT_TO_CHECK"
    
    if gcloud services list --enabled --filter="name:cloudaicompanion.googleapis.com" --format="value(name)" --project="$PROJECT_TO_CHECK" 2>/dev/null | grep -q "cloudaicompanion.googleapis.com"; then
        echo "✅ Cloud AI Companion API: enabled"
    else
        echo "❌ Cloud AI Companion API: not enabled"
        echo "   Run: gcloud services enable cloudaicompanion.googleapis.com --project=$PROJECT_TO_CHECK"
    fi
    
    if gcloud services list --enabled --filter="name:serviceusage.googleapis.com" --format="value(name)" --project="$PROJECT_TO_CHECK" 2>/dev/null | grep -q "serviceusage.googleapis.com"; then
        echo "✅ Service Usage API: enabled"
    else
        echo "❌ Service Usage API: not enabled"
        echo "   Run: gcloud services enable serviceusage.googleapis.com --project=$PROJECT_TO_CHECK"
    fi
fi

echo ""

# Application Default Credentialsの確認
ADC_PATH="$HOME/.config/gcloud/application_default_credentials.json"
if [ -f "$ADC_PATH" ]; then
    echo "✅ Application Default Credentials: configured"
else
    echo "❌ Application Default Credentials: not configured"
    echo "   Run: gcloud auth application-default login"
fi

echo ""

# 推奨アクション
echo "📝 Recommendations:"
echo ""

if [ -z "$GOOGLE_CLOUD_PROJECT" ] && [ -z "$CURRENT_PROJECT" ]; then
    echo "1. Set up a Google Cloud project:"
    echo "   export GOOGLE_CLOUD_PROJECT=your-project-id"
    echo "   gcloud config set project your-project-id"
    echo ""
fi

if ! command -v gcloud &> /dev/null; then
    echo "2. Install gcloud CLI:"
    echo "   https://cloud.google.com/sdk/docs/install"
    echo ""
fi

if [ ! -f "$ADC_PATH" ]; then
    echo "3. Set up authentication:"
    echo "   ./setup-gcp.sh"
    echo "   OR"
    echo "   gcloud auth application-default login"
    echo ""
fi

echo "4. Test the setup:"
echo "   # With OAuth:"
echo "   USE_OAUTH=true npm run dev:cli -- \"test query\""
echo ""
echo "   # With API Key:"
echo "   export GOOGLE_API_KEY=your-api-key"
echo "   npm run dev:cli -- \"test query\""