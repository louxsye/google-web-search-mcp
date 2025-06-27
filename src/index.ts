#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
  CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import { OAuth2Client } from 'google-auth-library';
import { getOauthClient } from './oauth.js';
import { setupUserProject, displaySetupInstructions } from './setup.js';

interface WebSearchArgs {
  query: string;
}

interface GroundingChunkWeb {
  uri?: string;
  title?: string;
}

interface GroundingChunkItem {
  web?: GroundingChunkWeb;
}

interface GroundingSupportSegment {
  startIndex: number;
  endIndex: number;
  text?: string;
}

interface GroundingSupportItem {
  segment?: GroundingSupportSegment;
  groundingChunkIndices?: number[];
  confidenceScores?: number[];
}

class GoogleWebSearchMCP {
  private server: Server;
  private genAI: GoogleGenerativeAI | null = null;
  private model: GenerativeModel | null = null;
  private oauthClient: OAuth2Client | null = null;
  private projectId: string | null = null;

  constructor() {
    this.server = new Server(
      {
        name: 'gemini-google-web-search-mcp',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
    this.setupErrorHandling();
  }

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

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'google_web_search',
            description: 'Performs a web search using Google Search (via the Gemini API) and returns the results. This tool is useful for finding information on the internet based on a query.',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'The search query to find information on the web.',
                },
              },
              required: ['query'],
            },
          } as Tool,
        ],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      if (name === 'google_web_search') {
        return await this.handleWebSearch(args as unknown as WebSearchArgs);
      }

      throw new Error(`Tool not found: ${name}`);
    });
  }

  private async handleWebSearch(args: WebSearchArgs): Promise<CallToolResult> {
    try {
      if (!this.model && !this.oauthClient) {
        await this.initializeGeminiClient();
      }

      if (!args.query || args.query.trim() === '') {
        return {
          content: [
            {
              type: 'text',
              text: 'Error: The query parameter cannot be empty.',
            },
          ],
          isError: true,
        };
      }

      let responseText: string;
      let sources: GroundingChunkItem[] | undefined;
      let groundingSupports: GroundingSupportItem[] | undefined;

      if (this.oauthClient) {
        // Use Code Assist API for OAuth authentication
        const result = await this.callCodeAssistAPI(args.query);
        responseText = result.responseText;
        sources = result.sources;
        groundingSupports = result.groundingSupports;
      } else if (this.model) {
        // Use Google Generative AI for API key authentication
        const chat = this.model.startChat({
          tools: [{ googleSearchRetrieval: {} }],
        });

        const result = await chat.sendMessage(args.query);
        const response = result.response;
        responseText = response.text();
        
        const groundingMetadata = response.candidates?.[0]?.groundingMetadata;
        sources = groundingMetadata?.groundingChunks as GroundingChunkItem[] | undefined;
        groundingSupports = groundingMetadata?.groundingSupports as GroundingSupportItem[] | undefined;
      } else {
        throw new Error('No authentication method available');
      }

      if (!responseText || !responseText.trim()) {
        return {
          content: [
            {
              type: 'text',
              text: `No search results or information found for query: "${args.query}"`,
            },
          ],
        };
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
          groundingSupports.forEach((support: GroundingSupportItem) => {
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

      return {
        content: [
          {
            type: 'text',
            text: `Web search results for "${args.query}":\n\n${modifiedResponseText}`,
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[Web Search Error]', error);
      
      return {
        content: [
          {
            type: 'text',
            text: `Error during web search for query "${args.query}": ${errorMessage}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async callCodeAssistAPI(query: string): Promise<{
    responseText: string;
    sources?: GroundingChunkItem[];
    groundingSupports?: GroundingSupportItem[];
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
      throw new Error(`Code Assist API error: ${response.status} ${response.statusText}`);
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

  private setupErrorHandling() {
    this.server.onerror = (error) => {
      console.error('[MCP Server Error]', error);
    };

    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      await this.server.close();
      process.exit(0);
    });

    process.on('uncaughtException', (error) => {
      console.error('[Uncaught Exception]', error);
      process.exit(1);
    });

    process.on('unhandledRejection', (reason, promise) => {
      console.error('[Unhandled Rejection]', reason);
      process.exit(1);
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Gemini Google Web Search MCP server running on stdio');
  }
}

const server = new GoogleWebSearchMCP();
server.run().catch((error) => {
  console.error('Failed to start MCP server:', error);
  process.exit(1);
});