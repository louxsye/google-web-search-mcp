#!/bin/bash

# Google Cloud Setup for Gemini Web Search MCP
# このスクリプトはGemini Code Assist APIを使用するために必要な設定を行います

set -e

echo "🚀 Setting up Google Cloud for Gemini Web Search MCP..."

# プロジェクトIDの確認
if [ -z "$GOOGLE_CLOUD_PROJECT" ]; then
    echo "❌ GOOGLE_CLOUD_PROJECT environment variable is not set."
    echo "Please set your Google Cloud project ID:"
    echo "export GOOGLE_CLOUD_PROJECT=your-project-id"
    exit 1
fi

echo "📋 Using Google Cloud Project: $GOOGLE_CLOUD_PROJECT"

# gcloudコマンドの存在確認
if ! command -v gcloud &> /dev/null; then
    echo "❌ gcloud CLI is not installed."
    echo "Please install Google Cloud CLI from: https://cloud.google.com/sdk/docs/install"
    exit 1
fi

# ログイン状態の確認
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q "."; then
    echo "❌ You are not logged in to gcloud."
    echo "Please run: gcloud auth login"
    exit 1
fi

echo "✅ gcloud CLI is available and you are logged in"

# プロジェクトの設定
echo "🔧 Setting project..."
gcloud config set project $GOOGLE_CLOUD_PROJECT

# 必要なAPIの有効化
echo "🔌 Enabling required APIs..."

# Gemini for Google Cloud API (Code Assist)
echo "  - Enabling cloudaicompanion.googleapis.com..."
gcloud services enable cloudaicompanion.googleapis.com --project=$GOOGLE_CLOUD_PROJECT

# Cloud Resource Manager API (必要に応じて)
echo "  - Enabling cloudresourcemanager.googleapis.com..."
gcloud services enable cloudresourcemanager.googleapis.com --project=$GOOGLE_CLOUD_PROJECT

# IAM API
echo "  - Enabling iam.googleapis.com..."
gcloud services enable iam.googleapis.com --project=$GOOGLE_CLOUD_PROJECT

# Service Usage API
echo "  - Enabling serviceusage.googleapis.com..."
gcloud services enable serviceusage.googleapis.com --project=$GOOGLE_CLOUD_PROJECT

echo "✅ APIs enabled successfully"

# Application Default Credentialsの設定
echo "🔐 Setting up Application Default Credentials..."
echo "This will open a browser for authentication..."
gcloud auth application-default login --scopes=https://www.googleapis.com/auth/cloud-platform,https://www.googleapis.com/auth/generative-language.retriever

echo "✅ Application Default Credentials configured"

# OAuth認証用の設定情報保存
echo "💾 Saving configuration..."
mkdir -p ~/.google-web-search
cat > ~/.google-web-search/config.json << EOF
{
  "project_id": "$GOOGLE_CLOUD_PROJECT",
  "api_enabled": true,
  "setup_date": "$(date -Iseconds)",
  "auth_type": "oauth"
}
EOF

echo "✅ Configuration saved to ~/.google-web-search/config.json"

# 設定確認
echo "🔍 Verifying setup..."

# プロジェクトの確認
CURRENT_PROJECT=$(gcloud config get-value project)
if [ "$CURRENT_PROJECT" = "$GOOGLE_CLOUD_PROJECT" ]; then
    echo "✅ Project configuration verified: $CURRENT_PROJECT"
else
    echo "❌ Project configuration mismatch"
    exit 1
fi

# APIの有効化確認
if gcloud services list --enabled --filter="name:cloudaicompanion.googleapis.com" --format="value(name)" | grep -q "cloudaicompanion.googleapis.com"; then
    echo "✅ Cloud AI Companion API is enabled"
else
    echo "❌ Cloud AI Companion API is not enabled"
    exit 1
fi

echo ""
echo "🎉 Setup completed successfully!"
echo ""
echo "📝 Next steps:"
echo "1. Test the OAuth authentication:"
echo "   USE_OAUTH=true npm run dev:cli -- \"test query\""
echo ""
echo "2. Or set your project ID and test:"
echo "   export GOOGLE_CLOUD_PROJECT=$GOOGLE_CLOUD_PROJECT"
echo "   USE_OAUTH=true npm run dev:cli -- \"明日の天気\""
echo ""
echo "📚 Troubleshooting:"
echo "- If you get permission errors, ensure your account has the required IAM roles"
echo "- If APIs are not enabled, run this script again or enable them manually in Cloud Console"
echo "- For more info, see: https://cloud.google.com/gemini/docs/discover/set-up-gemini"