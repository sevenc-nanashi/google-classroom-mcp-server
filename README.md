# sevenc-nanashi/google-classroom-mcp-server

This is a customized fork of [faizan45640/google-classroom-mcp-server](https://github.com/faizan45640/google-classroom-mcp-server) with additional features and improvements.

Changes:

- Use Node.js v24 and aube
- Migrate to TypeScript
- Add HTTP server mode
- Add course work materials retrieval
- Retrieve submission status for all your assignments

----

[![MseeP.ai Security Assessment Badge](https://mseep.net/pr/faizan45640-google-classroom-mcp-server-badge.png)](https://mseep.ai/app/faizan45640-google-classroom-mcp-server)

# Google Classroom MCP Server
[![smithery badge](https://smithery.ai/badge/@faizan45640/google-classroom-mcp-server)](https://smithery.ai/server/@faizan45640/google-classroom-mcp-server)

An MCP (Model Context Protocol) server that provides access to Google Classroom data through Claude and other AI assistants that support the MCP protocol.

## Setup

### Prerequisites

- Node.js 24 LTS or higher
- [aube 2.5.0](https://aube.sh/installation.html)
- A Google Cloud Platform project with the Google Classroom API enabled
- OAuth 2.0 client credentials for the Google Classroom API

### Installation

#### Installing via Smithery

To install Google Classroom MCP Server for Claude Desktop automatically via [Smithery](https://smithery.ai/server/@faizan45640/google-classroom-mcp-server):

```bash
aube dlx @smithery/cli install @faizan45640/google-classroom-mcp-server --client claude
```

#### Installing Manually
1. Clone this repository
2. Install dependencies:

```bash
aube install --frozen-lockfile
```

3. Place your Google OAuth client credentials in a file named `credentials.json` in the project root. Both **Web application** (`web`) and **Desktop app** (`installed`) credentials are supported. For a web application:

```json
{
  "web": {
    "client_id": "YOUR_CLIENT_ID",
    "project_id": "YOUR_PROJECT_ID",
    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
    "token_uri": "https://oauth2.googleapis.com/token",
    "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
    "client_secret": "YOUR_CLIENT_SECRET",
    "redirect_uris": ["http://localhost:3000/auth/google/callback"]
  }
}
```

For a desktop app, use the downloaded JSON with its `installed` key unchanged, for example:

```json
{
  "installed": {
    "client_id": "YOUR_CLIENT_ID",
    "client_secret": "YOUR_CLIENT_SECRET",
    "redirect_uris": ["http://localhost"]
  }
}
```

Desktop authentication uses an available local port automatically. If both keys are present, `installed` takes precedence. When switching OAuth clients, run the authentication command again to replace the saved tokens.

4. Authenticate with Google:

```bash
node index.ts auth
```

This will launch a browser window to complete the OAuth flow and save your credentials to `tokens.json`.

5. Configure Claude to use this server by updating `claude_desktop_config.json` (typically in `%APPDATA%\Claude\`):

```json
{
  "mcpServers": {
    "class": {
      "command": "node",
      "args": [
        "PATH_TO_YOUR_DIRECTORY\\index.ts"
      ]
    }
  }
}
```

## Usage

The TypeScript source runs directly on Node.js 24. To check types, run:

```bash
aube run typecheck
```

### HTTP mode

After authenticating with `node index.ts auth`, start the Streamable HTTP server:

```bash
node index.ts http
```

Connect an MCP HTTP client to `http://127.0.0.1:3000/mcp`. Set `PORT` to use another port, for example `PORT=3001 node index.ts http`.
HTTP mode is stateless and listens only on the local loopback interface. It uses the same saved Google credentials as stdio mode. Run `node index.ts` for stdio mode.

### Available Tools

The server provides several tools for interacting with Google Classroom:

#### 1. `courses` - List all your Google Classroom courses

```
Use the 'courses' tool to get a list of all your Google Classroom courses
```

#### 2. `course-details` - Get detailed information about a specific course

```
Use the 'course-details' tool with the courseId parameter to get details and announcements for a specific course
```

Parameters:
- `courseId`: The ID of the course (can be obtained from the `courses` tool)

#### 3. `assignments` - Get assignments for a specific course

```
Use the 'assignments' tool with the courseId parameter to get assignments and your submissions for a specific course
```

Parameters:
- `courseId`: The ID of the course (can be obtained from the `courses` tool)

Returns all pages of assignments and your own submissions in `yourSubmissions`. Match each submission's `courseWorkId` to an assignment's `id` to see its status:

- `NEW` / `CREATED`: Not yet turned in
- `TURNED_IN`: Submitted
- `RETURNED`: Returned by the teacher
- `RECLAIMED_BY_STUDENT`: Submission taken back by the student

Each [submission](https://developers.google.com/workspace/classroom/reference/rest/v1/courses.courseWork.studentSubmissions) also includes `late` and `assignedGrade` when provided by Google. `summary.submissionsFound` counts all submission records, including work not yet turned in. Retrieval failures return a tool error instead of an empty submission list. Uses the existing `classroom.coursework.me.readonly` permission.

#### 4. `course-work-materials` - Get materials for a specific course

Parameters:

- `courseId`: The course ID from the `courses` tool (required)
- `pageSize`: Maximum number of materials per page (optional; uses the API default)
- `pageToken`: The previous response's `nextPageToken` (optional)

Returns the [Classroom API response](https://developers.google.com/workspace/classroom/reference/rest/v1/courses.courseWorkMaterials/list), including `courseWorkMaterial` entries and `nextPageToken` when another page is available. Pass that token with the same other parameters to retrieve the next page. An empty result may omit `courseWorkMaterial`.

Existing users must run `node index.ts auth` again to grant the new `classroom.courseworkmaterials.readonly` scope before using this tool.

### Example Prompts for Claude

1. Show me all my Google Classroom courses
2. Get details for my Math course with ID 123456789
3. Show me all assignments for my History course with ID 987654321
4. Show me the course work materials for my History course with ID 987654321

## Permissions

The server requests the following Google Classroom API permissions:

- `classroom.courses.readonly` - To access course information
- `classroom.announcements.readonly` - To access course announcements
- `classroom.coursework.me.readonly` - To access your coursework and assignments
- `classroom.courseworkmaterials.readonly` - To access course work materials
- `classroom.rosters.readonly` - To access class rosters

## Troubleshooting

If you encounter permission errors, try:

1. Running the auth command again to refresh permissions:
   ```
   node index.ts auth
   ```

2. Ensuring your Google account is added as a test user in the Google Cloud Console if your app is in testing mode

3. Checking the OAuth scopes in the `authenticateAndSaveCredentials` function to ensure they match your needs

## Notes

- This server is designed to be used with Claude AI or other MCP-compatible assistants
- All API requests are made using your authenticated Google account
- Token refresh is handled automatically by the server
- Sensitive credentials are stored locally in the `tokens.json` file
