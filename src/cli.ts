#!/usr/bin/env node

import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import { OAuth2Client } from 'google-auth-library';
import { getOauthClient } from './oauth.js';
import { setupUserProject, displaySetupInstructions } from './setup.js';

interface GroundingChunkWeb {
  uri?: string;
  title?: string;
}

interface GroundingChunkItem {
  web?: GroundingChunkWeb;
}



class GoogleSearchCLI {
  private genAI: GoogleGenerativeAI | null = null;
  private model: GenerativeModel | null = null;
  private oauthClient: OAuth2Client | null = null;
  private projectId: string | null = null;

  private async initializeGeminiClient() {
    const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
    const useOAuth = process.env.USE_OAUTH === 'true' || !apiKey;
    
    if (useOAuth) {
      // OAuth using browser authentication
      console.error('Using OAuth authentication...');
      
      try {
        this.oauthClient = await getOauthClient();
        console.error('OAuth authentication successful');
        
        // プロジェクト設定
        this.projectId = await setupUserProject(this.oauthClient);
      } catch (error) {
        console.error('OAuth authentication failed:', error);
        if (error instanceof Error && error.message.includes('GOOGLE_CLOUD_PROJECT')) {
          displaySetupInstructions();
        }
        throw error;
      }
    } else if (apiKey) {
      // API Key Authenticate
      this.genAI = new GoogleGenerativeAI(apiKey);
      this.model = this.genAI.getGenerativeModel({ 
        model: 'gemini-2.0-flash-exp',
        generationConfig: {
          temperature: 0.7,
          topK: 40,
          topP: 0.95,
        }
      });
    } else {
      throw new Error(
        'Authentication required. Either set GOOGLE_API_KEY/GEMINI_API_KEY environment variable ' +
        'or set USE_OAUTH=true to use Google login. ' +
        'Get your API key from https://makersuite.google.com/app/apikey'
      );
    }
  }

  async search(query: string): Promise<void> {
    try {
      if (!this.model && !this.oauthClient) {
        await this.initializeGeminiClient();
      }

      if (!query || query.trim() === '') {
        console.error('Error: The query parameter cannot be empty.');
        process.exit(1);
      }

      let responseText: string;
      let sources: GroundingChunkItem[] | undefined;
      let groundingSupports: any[] | undefined;

      if (this.oauthClient) {
        // Use Code Assist API for OAuth authentication
        const result = await this.callCodeAssistAPI(query);
        responseText = result.responseText;
        sources = result.sources;
        groundingSupports = result.groundingSupports;
      } else if (this.model) {
        // Use Google Generative AI for API key authentication
        const chat = this.model.startChat({
          tools: [{ googleSearchRetrieval: {} }],
        });

        const result = await chat.sendMessage(query);
        const response = result.response;
        responseText = response.text();
        
        const groundingMetadata = response.candidates?.[0]?.groundingMetadata;
        sources = groundingMetadata?.groundingChunks as GroundingChunkItem[] | undefined;
        groundingSupports = groundingMetadata?.groundingSupports as any[] | undefined;
      } else {
        throw new Error('No authentication method available');
      }

      if (!responseText || !responseText.trim()) {
        console.log(`No search results or information found for query: "${query}"`);
        return;
      }

      let modifiedResponseText = responseText;
      const sourceListFormatted: string[] = [];

      if (sources && sources.length > 0) {
        sources.forEach((source: GroundingChunkItem, index: number) => {
          const title = source.web?.title || 'Untitled';
          const uri = source.web?.uri || 'No URI';
          sourceListFormatted.push(`[${index + 1}] ${title} (${uri})`);
        });

        if (groundingSupports && groundingSupports.length > 0) {
          const insertions: Array<{ index: number; marker: string }> = [];
          groundingSupports.forEach((support: any) => {
            if (support.segment && support.groundingChunkIndices) {
              const citationMarker = support.groundingChunkIndices
                .map((chunkIndex: number) => `[${chunkIndex + 1}]`)
                .join('');
              insertions.push({
                index: support.segment.endIndex,
                marker: citationMarker,
              });
            }
          });

          insertions.sort((a, b) => b.index - a.index);

          const responseChars = modifiedResponseText.split('');
          insertions.forEach((insertion) => {
            responseChars.splice(insertion.index, 0, insertion.marker);
          });
          modifiedResponseText = responseChars.join('');
        }

        if (sourceListFormatted.length > 0) {
          modifiedResponseText += '\n\nSources:\n' + sourceListFormatted.join('\n');
        }
      }

      console.log(`Web search results for "${query}":\n\n${modifiedResponseText}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`Error during web search for query "${query}": ${errorMessage}`);
      process.exit(1);
    }
  }

  private async callCodeAssistAPI(query: string): Promise<{
    responseText: string;
    sources?: GroundingChunkItem[];
    groundingSupports?: any[];
  }> {
    if (!this.oauthClient) {
      throw new Error('OAuth client not initialized');
    }

    const projectId = this.projectId || process.env.GOOGLE_CLOUD_PROJECT;
    
    if (!projectId) {
      throw new Error('Project ID not available. Please run setup first.');
    }
    
    const endpoint = 'https://cloudcode-pa.googleapis.com/v1internal:generateContent';
    
    const requestBody = {
      model: 'gemini-2.5-flash',
      project: projectId,
      request: {
        contents: [
          {
            role: 'user',
            parts: [{ text: query }]
          }
        ],
        tools: [
          {
            googleSearch: {}
          }
        ]
      }
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${(await this.oauthClient.getAccessToken()).token}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('API Error Response:', errorText);
      throw new Error(`Code Assist API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const result = await response.json();
    const responseText = result.response?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const groundingMetadata = result.response?.candidates?.[0]?.groundingMetadata;
    
    return {
      responseText,
      sources: groundingMetadata?.groundingChunks,
      groundingSupports: groundingMetadata?.groundingSupports,
    };
  }
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage: gsearch <query>');
    console.log('Example: gsearch "latest news about AI"');
    process.exit(1);
  }

  const query = args.join(' ');
  const cli = new GoogleSearchCLI();
  await cli.search(query);
}

main().catch((error) => {
  console.error('Failed to run Google Search CLI:', error);
  process.exit(1);
});