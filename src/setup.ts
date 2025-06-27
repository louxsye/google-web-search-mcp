import { OAuth2Client } from 'google-auth-library';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

interface ProjectSetupResponse {
  cloudaicompanionProject?: string;
  userTier?: string;
  onboardingRequired?: boolean;
}

interface ClientMetadata {
  ideType: string;
  platform: string;
  pluginType: string;
  duetProject?: string;
}

export async function setupUserProject(authClient: OAuth2Client): Promise<string> {
  let projectId = process.env.GOOGLE_CLOUD_PROJECT;
  
  // 設定ファイルから既存のプロジェクトIDを読み込み
  try {
    const configPath = path.join(os.homedir(), '.google-web-search', 'config.json');
    const configData = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(configData);
    if (config.project_id && !projectId) {
      projectId = config.project_id;
      console.error(`Using saved project ID: ${projectId}`);
    }
  } catch (error) {
    // 設定ファイルが存在しない場合は無視
  }

  // まずloadCodeAssistを呼び出してプロジェクトを検出（プロジェクトIDなしでも試行）
  try {
    console.error('🔍 Detecting available projects...');
    const loadResult = await loadCodeAssist(authClient, projectId);
    
    if (loadResult.cloudaicompanionProject) {
      projectId = loadResult.cloudaicompanionProject;
      console.error(`✅ Detected project: ${projectId}`);
      
      // 検出されたプロジェクトIDを保存
      await saveProjectConfig(projectId);
    }

    // オンボーディングが必要な場合（プロジェクトIDの有無に関わらず）
    if (loadResult.onboardingRequired) {
      console.error('⚙️  Setting up Code Assist for your account...');
      const onboardedProjectId = await onboardUser(authClient, projectId);
      if (onboardedProjectId) {
        projectId = onboardedProjectId;
        console.error(`✅ Setup completed with project: ${projectId}`);
        await saveProjectConfig(projectId);
      }
    }

    // まだプロジェクトIDが取得できない場合
    if (!projectId) {
      console.error('⚠️  No project detected automatically.');
      console.error('Please create a Google Cloud project:');
      console.error('1. Go to: https://console.cloud.google.com/projectcreate');
      console.error('2. Create a new project'); 
      console.error('3. Set: export GOOGLE_CLOUD_PROJECT=your-project-id');
      console.error('4. Run this command again');
      throw new Error('GOOGLE_CLOUD_PROJECT is required');
    }

    console.error(`✅ Project setup completed: ${projectId}`);
    return projectId;
  } catch (error) {
    console.error('❌ Project setup failed:', error);
    
    // フォールバック: 環境変数やセットアップスクリプトを案内
    if (!projectId) {
      console.error('');
      console.error('💡 Try one of these solutions:');
      console.error('1. Set project manually: export GOOGLE_CLOUD_PROJECT=your-project-id');
      console.error('2. Run setup script: ./setup-gcp.sh');
      console.error('3. Use API key instead: export GOOGLE_API_KEY=your-api-key');
    }
    throw error;
  }
}

async function loadCodeAssist(authClient: OAuth2Client, projectId?: string): Promise<ProjectSetupResponse> {
  const endpoint = 'https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist';
  
  const clientMetadata: ClientMetadata = {
    ideType: 'IDE_UNSPECIFIED',
    platform: 'PLATFORM_UNSPECIFIED', 
    pluginType: 'GEMINI',
    duetProject: projectId,
  };

  const requestBody = {
    cloudaicompanionProject: projectId, // プロジェクトIDがnullでも送信
    metadata: clientMetadata,
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${(await authClient.getAccessToken()).token}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Load Code Assist API Error:', errorText);
    
    if (response.status === 404 || response.status === 403) {
      // プロジェクトが見つからない場合、オンボーディングが必要
      return { onboardingRequired: true };
    }
    throw new Error(`Load Code Assist failed: ${response.status} ${response.statusText} - ${errorText}`);
  }

  return await response.json();
}

async function onboardUser(authClient: OAuth2Client, projectId?: string): Promise<string> {
  const endpoint = 'https://cloudcode-pa.googleapis.com/v1internal:onboardUser';
  
  const requestBody = {
    tierId: 'LEGACY', // デフォルトのtier
    cloudaicompanionProject: projectId || null,
    metadata: {
      ideType: 'IDE_UNSPECIFIED',
      platform: 'PLATFORM_UNSPECIFIED',
      pluginType: 'GEMINI',
    },
  };

  const response = await fetch(endpoint, {
    method: 'POST', 
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${(await authClient.getAccessToken()).token}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Onboard User API Error:', errorText);
    throw new Error(`User onboarding failed: ${response.status} ${response.statusText} - ${errorText}`);
  }

  const result = await response.json();
  console.error('✅ User onboarding completed');
  
  // レスポンスからプロジェクトIDを取得
  const resultProjectId = result.response?.cloudaicompanionProject?.id || result.cloudaicompanionProject || projectId;
  return resultProjectId;
}

export async function checkApiEnabled(projectId: string): Promise<boolean> {
  try {
    // Google Cloud Service Usage APIを使用してAPI有効化状態を確認
    const endpoint = `https://serviceusage.googleapis.com/v1/projects/${projectId}/services/cloudaicompanion.googleapis.com`;
    
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${process.env.GOOGLE_ACCESS_TOKEN}`,
      },
    });

    if (response.ok) {
      const result = await response.json();
      return result.state === 'ENABLED';
    }
    return false;
  } catch (error) {
    console.error('Error checking API status:', error);
    return false;
  }
}

async function saveProjectConfig(projectId: string): Promise<void> {
  try {
    const configDir = path.join(os.homedir(), '.google-web-search');
    const configPath = path.join(configDir, 'config.json');
    
    await fs.mkdir(configDir, { recursive: true });
    
    const config = {
      project_id: projectId,
      setup_date: new Date().toISOString(),
      auth_type: 'oauth'
    };
    
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));
    console.error(`💾 Saved project configuration: ${configPath}`);
  } catch (error) {
    console.error('Warning: Could not save project configuration:', error);
  }
}

export function displaySetupInstructions(): void {
  console.error('');
  console.error('🚀 Google Cloud Setup Required');
  console.error('');
  console.error('To use OAuth authentication, please complete the following setup:');
  console.error('');
  console.error('1. Run the setup script:');
  console.error('   ./setup-gcp.sh');
  console.error('');
  console.error('2. Or manually set up:');
  console.error('   export GOOGLE_CLOUD_PROJECT=your-project-id');
  console.error('   gcloud services enable cloudaicompanion.googleapis.com');
  console.error('   gcloud auth application-default login');
  console.error('');
  console.error('3. Then try again:');
  console.error('   USE_OAUTH=true npm run dev:cli -- "your query"');
  console.error('');
}