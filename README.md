# Gemini Google Web Search MCP Server

An MCP (Model Context Protocol) server that provides Google Web Search functionality using the Gemini API. This server is extracted from the official Gemini CLI's web search tool.

## Features

- Google Web Search via Gemini API
- Citation support with source links
- Grounding metadata for accurate information retrieval
- Fully compatible with Claude Desktop and other MCP clients

## Prerequisites

- Node.js 18+
- Google API Key (Gemini API access)

## Installation

### Via npm (when published)
```bash
npm install -g gemini-google-web-search-mcp
```

### From source
```bash
git clone https://github.com/yourusername/gemini-google-web-search-mcp.git
cd gemini-google-web-search-mcp
npm install
npm run build
```

## Setup

### 1. Get a Google API Key

Visit [Google AI Studio](https://makersuite.google.com/app/apikey) to create your API key.

### 2. Configure Claude Desktop

Add the following to your Claude Desktop configuration file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`  
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`  
**Linux**: `~/.config/Claude/claude_desktop_config.json`

**Option 1: API Key Authentication**
```json
{
  "mcpServers": {
    "google-web-search": {
      "command": "node",
      "args": ["/path/to/gemini-google-web-search-mcp/dist/index.js"],
      "env": {
        "GOOGLE_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

**Option 2: OAuth Authentication (No API Key Required)**
```json
{
  "mcpServers": {
    "google-web-search": {
      "command": "node",
      "args": ["/path/to/gemini-google-web-search-mcp/dist/index-codeassist.js"],
      "env": {
        "USE_OAUTH": "true"
      }
    }
  }
}
```

## Usage

Once configured, the `google_web_search` tool will be available in Claude Desktop. You can use it by asking Claude to search for information:

- "Search for the latest news about MCP protocol"
- "Find information about TypeScript 5.0 features"
- "Look up recent developments in AI safety"

## Environment Variables

- `GOOGLE_API_KEY` or `GEMINI_API_KEY`: Your Google API key (required)
- `GEMINI_MODEL`: Gemini model to use (default: `gemini-2.0-flash-exp`)
- `USE_OAUTH`: Set to `true` to use OAuth authentication (experimental, not fully supported)
- `GOOGLE_APPLICATION_CREDENTIALS`: Path to service account credentials (optional)

## Authentication Methods

### 1. API Key Authentication (Recommended)
The easiest way to authenticate is using an API key:
```bash
export GOOGLE_API_KEY=your-api-key-here
```

### 2. OAuth Authentication with Code Assist API (Setup Required)
OAuth authentication uses Google's Code Assist API, which provides web search functionality with Google login.

**Setup Steps:**

1. **Set OAuth credentials (if using custom OAuth app):**
   ```bash
   export OAUTH_CLIENT_ID=your-oauth-client-id
   export OAUTH_CLIENT_SECRET=your-oauth-client-secret
   ```

2. **Run the automated setup script:**
   ```bash
   ./setup-gcp.sh
   ```

3. **Or manually configure:**
   ```bash
   # Set your Google Cloud project ID
   export GOOGLE_CLOUD_PROJECT=your-project-id
   
   # Enable required APIs
   gcloud services enable cloudaicompanion.googleapis.com
   
   # Set up authentication
   gcloud auth application-default login \
     --scopes=https://www.googleapis.com/auth/cloud-platform,https://www.googleapis.com/auth/generative-language.retriever
   ```

4. **Use OAuth authentication:**
   ```bash
   export USE_OAUTH=true
   npm run dev:cli -- "your search query"
   ```

**Requirements:**
- Google Cloud project with billing enabled
- Cloud AI Companion API enabled
- Gemini Code Assist subscription (free tier available)

**Note**: This uses the same authentication flow as Gemini CLI and accesses Google's Code Assist API for web search functionality.

## Development

### Building
```bash
npm run build
```

### Running in development
```bash
npm run dev
```

### Testing
```bash
# Set your API key
export GOOGLE_API_KEY=your-api-key-here

# Run the test
npm test
```

## MCP Protocol Implementation

This server implements the Model Context Protocol with:

- **Tool**: `google_web_search`
  - **Input**: `query` (string) - The search query
  - **Output**: Search results with citations and source links

## License

Apache 2.0 - This project is derived from Google's Gemini CLI which is licensed under Apache 2.0.

## Credits

This MCP server is based on the web search functionality from [Google's official Gemini CLI](https://github.com/google-gemini/gemini-cli).

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Troubleshooting

### API Key Issues
- Ensure your API key is valid and has access to Gemini API
- Check that the environment variable is properly set

### Connection Issues  
- Verify that the MCP server is properly configured in Claude Desktop
- Check server logs for any error messages

### Search Not Working
- Ensure you have internet connectivity
- Check if the Gemini API is accessible from your location
- Verify that your API key has not exceeded rate limits