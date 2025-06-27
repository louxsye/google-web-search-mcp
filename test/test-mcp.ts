import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function testMCPServer() {
  console.log('Testing Gemini Google Web Search MCP Server...\n');

  const serverPath = join(__dirname, '..', 'dist', 'index.js');
  const mcp = spawn('node', [serverPath], {
    env: {
      ...process.env,
      GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let responseData = '';

  mcp.stdout.on('data', (data) => {
    responseData += data.toString();
    const lines = responseData.split('\n');
    
    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i].trim();
      if (line) {
        try {
          const response = JSON.parse(line);
          console.log('Response:', JSON.stringify(response, null, 2));
        } catch (e) {
          // Not JSON, might be server messages
        }
      }
    }
    
    responseData = lines[lines.length - 1];
  });

  mcp.stderr.on('data', (data) => {
    console.error('Server message:', data.toString());
  });

  mcp.on('error', (error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });

  // Test 1: List tools
  console.log('Test 1: Listing available tools...');
  const listToolsRequest = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list',
  };
  
  mcp.stdin.write(JSON.stringify(listToolsRequest) + '\n');

  // Wait a bit for the response
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Test 2: Call web search tool
  console.log('\nTest 2: Performing web search...');
  const searchRequest = {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'google_web_search',
      arguments: {
        query: 'MCP Model Context Protocol latest news',
      },
    },
  };
  
  mcp.stdin.write(JSON.stringify(searchRequest) + '\n');

  // Wait for responses
  await new Promise(resolve => setTimeout(resolve, 5000));

  // Clean up
  mcp.kill();
  console.log('\nTest completed.');
}

// Check for API key
if (!process.env.GOOGLE_API_KEY && !process.env.GEMINI_API_KEY) {
  console.error('Error: GOOGLE_API_KEY or GEMINI_API_KEY environment variable is required.');
  console.error('Get your API key from https://makersuite.google.com/app/apikey');
  process.exit(1);
}

testMCPServer().catch(console.error);