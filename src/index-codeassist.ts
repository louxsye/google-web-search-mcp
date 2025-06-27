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
import { getOauthClient } from './oauth.js';
import { AuthClient } from 'google-auth-library';

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
  private authClient: AuthClient | null = null;
  private useCodeAssist: boolean = false;

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
    const useOAuth = process.env.USE_OAUTH === 'true' || process.env.USE_CODE_ASSIST === 'true' || !apiKey;
    
    if (useOAuth) {
      // OAuth認証でCode Assist APIを使用
      console.error('Using OAuth authentication with Code Assist API...');
      
      try {
        this.authClient = await getOauthClient();
        this.useCodeAssist = true;
        console.error('Code Assist authentication successful!');
        return;
      } catch (error) {
        console.error('OAuth authentication failed:', error);
        throw error;
      }
    } else if (apiKey) {
      // API Key認証で通常のGemini APIを使用
      console.error('Using API key authentication with Gemini API...');
      this.genAI = new GoogleGenerativeAI(apiKey);
      this.model = this.genAI.getGenerativeModel({ 
        model: 'gemini-2.0-flash-exp',
        generationConfig: {
          temperature: 0.7,
          topK: 40,
          topP: 0.95,
        }
      });
      this.useCodeAssist = false;
    } else {
      throw new Error(
        'Authentication required. Either set GOOGLE_API_KEY/GEMINI_API_KEY environment variable ' +
        'or set USE_OAUTH=true or USE_CODE_ASSIST=true to use Google login. ' +
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
            description: 'Performs a web search using Google Search (via the Gemini API or Code Assist API) and returns the results. This tool is useful for finding information on the internet based on a query.',
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
      if (!this.model && !this.authClient) {
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
      let groundingMetadata: any;
      let sources: GroundingChunkItem[] | undefined;
      let groundingSupports: GroundingSupportItem[] | undefined;

      if (this.useCodeAssist && this.authClient) {
        // Code Assist APIを使用
        console.error('Calling Code Assist API...');
        const response = await this.callCodeAssistAPI(args.query);
        responseText = this.extractResponseText(response);
        groundingMetadata = response.candidates?.[0]?.groundingMetadata;
        sources = groundingMetadata?.groundingChunks as GroundingChunkItem[] | undefined;
        groundingSupports = groundingMetadata?.groundingSupports as GroundingSupportItem[] | undefined;
      } else {
        // 通常のGemini APIを使用
        console.error('Calling Gemini API...');
        const chat = this.model!.startChat({
          tools: [{ googleSearchRetrieval: {} }],
        });

        const result = await chat.sendMessage(args.query);
        const response = result.response;
        responseText = response.text();
        
        groundingMetadata = response.candidates?.[0]?.groundingMetadata;
        sources = groundingMetadata?.groundingChunks as GroundingChunkItem[] | undefined;
        groundingSupports = groundingMetadata?.groundingSupports as GroundingSupportItem[] | undefined;
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

      const authMethod = this.useCodeAssist ? 'Code Assist API (OAuth)' : 'Gemini API (API Key)';
      console.error(`Search completed using ${authMethod}`);

      return {
        content: [
          {
            type: 'text',
            text: `Web search results for "${args.query}" (via ${authMethod}):\n\n${modifiedResponseText}`,
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

  private async callCodeAssistAPI(query: string): Promise<any> {
    const CODE_ASSIST_ENDPOINT = 'https://cloudcode-pa.googleapis.com';
    const CODE_ASSIST_API_VERSION = 'v1internal';
    
    const requestBody = {
      contents: [
        {
          role: 'user',
          parts: [{ text: query }]
        }
      ],
      tools: [{ googleSearch: {} }],
      generationConfig: {
        temperature: 0.7,
        topK: 40,
        topP: 0.95,
      }
    };

    const response = await this.authClient!.request({
      url: `${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}:generateContent`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      responseType: 'json',
      body: JSON.stringify(requestBody),
    });

    return response.data;
  }

  private extractResponseText(response: any): string {
    if (response.candidates && response.candidates[0] && response.candidates[0].content) {
      const parts = response.candidates[0].content.parts;
      if (parts && parts.length > 0) {
        return parts.map((part: any) => part.text || '').join('');
      }
    }
    return '';
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
    console.error('Gemini Google Web Search MCP server running on stdio (Code Assist enabled)');
  }
}

const server = new GoogleWebSearchMCP();
server.run().catch((error) => {
  console.error('Failed to start MCP server:', error);
  process.exit(1);
});