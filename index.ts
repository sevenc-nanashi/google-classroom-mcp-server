#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { once } from "node:events";
import { createServer } from "node:http";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { google, type classroom_v1 } from 'googleapis';
import { authenticate } from "@google-cloud/local-auth";
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'node:url';

const TOKEN_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "tokens.json"
);

// Paths for client credentials and tokens
const CLIENT_CREDENTIALS_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "credentials.json"
);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Load the client credentials from the JSON file
async function loadClientCredentials() {
  console.error('Loading client credentials from:', CLIENT_CREDENTIALS_PATH);
  try {
    const credentialsContent = await fs.readFile(CLIENT_CREDENTIALS_PATH, 'utf8');
    const credentials = z.object({
      installed: z.unknown().optional(),
      web: z.unknown().optional()
    }).parse(JSON.parse(credentialsContent));
    return z.object({
      client_id: z.string().min(1),
      client_secret: z.string().min(1),
      redirect_uris: z.array(z.url()).nonempty()
    }).parse(credentials.installed !== undefined ? credentials.installed : credentials.web);
  } catch (error) {
    console.error('Failed to load client credentials:', errorMessage(error));
    throw new Error(`Failed to load client credentials: ${errorMessage(error)}`);
  }
}

async function authenticateAndSaveCredentials() {
  console.error('Starting authentication process...');
  const credentials = await loadClientCredentials();
  console.error('Client credentials loaded successfully:', credentials.client_id);

  console.error('Launching OAuth2 flow with @google-cloud/local-auth...');
  const auth = await authenticate({
    keyfilePath: CLIENT_CREDENTIALS_PATH,
    scopes: [
      'https://www.googleapis.com/auth/classroom.courses.readonly',
      'https://www.googleapis.com/auth/classroom.announcements.readonly',
      'https://www.googleapis.com/auth/classroom.coursework.me.readonly',
      'https://www.googleapis.com/auth/classroom.courseworkmaterials.readonly',
      'https://www.googleapis.com/auth/classroom.rosters.readonly'
    ],
  });

  console.error('Authentication successful, saving credentials to:', TOKEN_PATH);
  await fs.writeFile(TOKEN_PATH, JSON.stringify(auth.credentials));
  console.error('Credentials saved successfully.');
  return auth;
}

async function loadCredentials() {
  console.error('Checking for saved credentials at:', TOKEN_PATH);
  if (!await fs.access(TOKEN_PATH).then(() => true).catch(() => false)) {
    console.error('Credentials file does not exist.');
    throw new Error('Credentials not found. Please run with "auth" argument first.');
  }
  console.error('Credentials file found, loading...');
  let credentials;
  try {
    credentials = JSON.parse(await fs.readFile(TOKEN_PATH, 'utf-8'));
  } catch (error) {
    console.error('Failed to parse credentials:', errorMessage(error));
    throw new Error('Failed to parse credentials: Invalid JSON in tokens.json');
  }
  console.error('Credentials loaded:', credentials.access_token ? 'Access token present' : 'No access token');

  const client = await loadClientCredentials();
  const auth = new google.auth.OAuth2(client.client_id, client.client_secret);
  auth.setCredentials(credentials);

  // Handle token refresh
  auth.on('tokens', async (tokens) => {
    console.error('Received new tokens from Google Auth Library');
    if (tokens.refresh_token) {
      console.error('Updating refresh token in saved credentials');
      const existingCredentials = JSON.parse(await fs.readFile(TOKEN_PATH, 'utf-8'));
      existingCredentials.refresh_token = tokens.refresh_token;
      await fs.writeFile(TOKEN_PATH, JSON.stringify(existingCredentials));
    }
    if (tokens.access_token) {
      console.error('Updating access token in saved credentials');
      const existingCredentials = JSON.parse(await fs.readFile(TOKEN_PATH, 'utf-8'));
      existingCredentials.access_token = tokens.access_token;
      existingCredentials.expiry_date = tokens.expiry_date;
      await fs.writeFile(TOKEN_PATH, JSON.stringify(existingCredentials));
    }
  });

  return auth;
}

async function setupClassroomClient() {
  const auth = await loadCredentials();
  return google.classroom({
    version: 'v1',
    auth
  });
}

function createMcpServer() {
  const server = new McpServer({
    name: "class",
    version: "1.0.0"
  });

  server.tool("add",
    { a: z.number(), b: z.number() },
    async ({ a, b }) => ({
      content: [{ type: "text", text: String(a + b) }]
    })
  );

  server.tool("courses",
    {},
    async () => {
      try {
        console.error('Attempting to fetch courses...');
        const classroom = await setupClassroomClient();
        console.error('Classroom client initialized, fetching courses...');
        const courses = await classroom.courses.list();
        console.error('Courses fetched successfully:', courses.data.courses?.length || 0, 'courses found');
        return {
          content: [{ type: "text", text: JSON.stringify(courses.data) }]
        };
      } catch (error) {
        console.error('Error fetching courses:', errorMessage(error));
        if (errorMessage(error).includes('Credentials not found')) {
          return {
            content: [{
              type: "text",
              text: "Authentication required. Please run the script with the 'auth' argument to authenticate: `node index.ts auth`"
            }]
          };
        }
        if (errorMessage(error).includes('access_denied')) {
          return {
            content: [{
              type: "text",
              text: "Authentication failed: This app is in testing mode. Ensure your account (faizan45640@gmail.com) is added as a test user in the Google Cloud Console under OAuth consent screen > Test users."
            }]
          };
        }
        return {
          content: [{ type: "text", text: `Error fetching courses: ${errorMessage(error)}` }]
        };
      }
    }
  );

  server.tool("course-details",
    { courseId: z.string().describe("The ID of the course to get details for") },
    async ({ courseId }) => {
      try {
        console.error(`Attempting to fetch details for course ${courseId}...`);
        const classroom = await setupClassroomClient();

        // Get course details
        console.error('Fetching course details...');
        let courseDetails;
        try {
          courseDetails = await classroom.courses.get({ id: courseId });
          console.error('Course details fetched successfully');
        } catch (courseError) {
          console.error('Error fetching course details:', errorMessage(courseError));
          throw new Error(`Failed to fetch course details: ${errorMessage(courseError)}`);
        }

        // Get course announcements
        console.error('Fetching course announcements...');
        let announcements: { data: classroom_v1.Schema$ListAnnouncementsResponse } = { data: { announcements: [] } };
        try {
          announcements = await classroom.courses.announcements.list({
            courseId: courseId,
            pageSize: 20
          });
          console.error(`Announcements fetched successfully: ${announcements.data.announcements?.length || 0} found`);
        } catch (announcementError) {
          console.error('Error fetching announcements:', errorMessage(announcementError));
          // Don't throw here, just log the error and continue with empty announcements
          if (errorMessage(announcementError).includes('permission')) {
            console.error('Permission error accessing announcements. Check your OAuth scopes.');
          }
        }

        const result = {
          courseDetails: courseDetails.data,
          announcements: announcements.data.announcements || [],
          note: announcements.data.announcements ? "" : "No announcements available or insufficient permissions to access them."
        };

        console.error(`Details for course ${courseId} fetched successfully`);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
        };
      } catch (error) {
        console.error(`Error fetching details for course ${courseId}:`, errorMessage(error));

        if (errorMessage(error).includes('Credentials not found')) {
          return {
            content: [{
              type: "text",
              text: "Authentication required. Please run the script with the 'auth' argument to authenticate: `node index.ts auth`"
            }]
          };
        }

        if (errorMessage(error).includes('permission') || errorMessage(error).includes('access_denied')) {
          return {
            content: [{
              type: "text",
              text: "Permission denied. You need to re-authenticate with the proper scopes. Please run the script with the 'auth' argument: `node index.ts auth` and ensure you grant all requested permissions."
            }]
          };
        }

        if (errorMessage(error).includes('not found')) {
          return {
            content: [{
              type: "text",
              text: `Course with ID ${courseId} not found. Please check the course ID and try again.`
            }]
          };
        }

        return {
          content: [{ type: "text", text: `Error fetching course details: ${errorMessage(error)}` }]
        };
      }
    }
  );

  server.tool("course-work-materials",
    {
      courseId: z.string().min(1).describe("The ID of the course to get materials for"),
      pageSize: z.number().int().positive().optional().describe("Maximum number of materials to return"),
      pageToken: z.string().min(1).optional().describe("nextPageToken from the previous response; keep other parameters unchanged")
    },
    async ({ courseId, pageSize, pageToken }) => {
      try {
        const classroom = await setupClassroomClient();
        const materials = await classroom.courses.courseWorkMaterials.list({ courseId, pageSize, pageToken });
        return {
          content: [{ type: "text", text: JSON.stringify(materials.data) }]
        };
      } catch (error) {
        const message = errorMessage(error);
        console.error(`Error fetching course work materials for ${courseId}:`, message);
        return {
          isError: true,
          content: [{
            type: "text",
            text: `Error fetching course work materials: ${message}. For missing credentials or insufficient scopes, run \`node index.ts auth\` and grant classroom.courseworkmaterials.readonly.`
          }]
        };
      }
    }
  );

  server.tool("assignments",
    "Get all course assignments and your submission status, including unsubmitted work, lateness, and grades",
    {
      courseId: z.string().min(1).describe("The ID of the course to get assignments for")
    },
    async ({ courseId }) => {
      try {
        console.error(`Attempting to fetch assignments for course ${courseId}...`);
        const classroom = await setupClassroomClient();

        // Verify the course exists first
        try {
          await classroom.courses.get({ id: courseId });
          console.error('Course verified successfully');
        } catch (courseError) {
          console.error('Error verifying course:', errorMessage(courseError));
          throw new Error(`Failed to verify course: ${errorMessage(courseError)}`);
        }

        const assignments: classroom_v1.Schema$CourseWork[] = [];
        let assignmentsPageToken: string | undefined;
        do {
          const response = await classroom.courses.courseWork.list({
            courseId,
            pageSize: 50,
            orderBy: 'dueDate desc',
            pageToken: assignmentsPageToken
          });
          if (response.data.courseWork) {
            assignments.push(...response.data.courseWork);
          }
          if (!response.data.nextPageToken) break;
          assignmentsPageToken = response.data.nextPageToken;
        } while (true);

        // Include every submission state, including work not yet turned in.
        const submissions: classroom_v1.Schema$StudentSubmission[] = [];
        let submissionsPageToken: string | undefined;
        do {
          const response = await classroom.courses.courseWork.studentSubmissions.list({
            courseId,
            courseWorkId: '-',
            userId: 'me',
            pageToken: submissionsPageToken
          });
          if (response.data.studentSubmissions) {
            submissions.push(...response.data.studentSubmissions);
          }
          if (!response.data.nextPageToken) break;
          submissionsPageToken = response.data.nextPageToken;
        } while (true);

        // Format the response
        const result = {
          courseId: courseId,
          assignments,
          yourSubmissions: submissions,
          summary: {
            totalAssignments: assignments.length,
            submissionsFound: submissions.length
          }
        };

        console.error(`Assignments data for course ${courseId} fetched successfully`);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
        };
      } catch (error) {
        console.error(`Error fetching assignments for course ${courseId}:`, errorMessage(error));

        if (errorMessage(error).includes('Credentials not found')) {
          return {
            isError: true,
            content: [{
              type: "text",
              text: "Authentication required. Please run the script with the 'auth' argument to authenticate: `node index.ts auth`"
            }]
          };
        }

        if (errorMessage(error).includes('permission') || errorMessage(error).includes('access_denied')) {
          return {
            isError: true,
            content: [{
              type: "text",
              text: "Permission denied accessing assignments. You need to re-authenticate with the proper scopes. Please run the script with the 'auth' argument: `node index.ts auth` and ensure you grant all requested permissions."
            }]
          };
        }

        if (errorMessage(error).includes('not found')) {
          return {
            isError: true,
            content: [{
              type: "text",
              text: `Course with ID ${courseId} not found. Please check the course ID and try again.`
            }]
          };
        }

        return {
          isError: true,
          content: [{ type: "text", text: `Error fetching assignments: ${errorMessage(error)}` }]
        };
      }
    }
  );
  return server;
}

async function startHttpServer() {
  const port = z.string().default("3000").pipe(z.coerce.number<string>().int().min(1).max(65535)).parse(process.env.PORT);
  const httpServer = createServer(async (request, response) => {
    if (request.url !== "/mcp") {
      response.writeHead(404).end();
      return;
    }
    if (request.method !== "POST") {
      response.writeHead(405, { Allow: "POST" }).end();
      return;
    }

    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      enableDnsRebindingProtection: true,
      allowedHosts: [`127.0.0.1:${port}`, `localhost:${port}`],
      allowedOrigins: [`http://127.0.0.1:${port}`, `http://localhost:${port}`]
    });
    response.on("close", () => {
      void server.close().catch((error) => console.error("Failed to close MCP request:", errorMessage(error)));
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(request, response);
    } catch (error) {
      console.error("Failed to handle MCP request:", errorMessage(error));
      if (!response.headersSent) {
        response.writeHead(500, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32603, message: "Internal server error" } }));
      } else {
        response.end();
      }
    }
  });
  httpServer.listen(port, "127.0.0.1");
  await once(httpServer, "listening");
  console.error(`MCP HTTP server listening at http://127.0.0.1:${port}/mcp`);
}

async function main() {
  if (process.argv[2] === "auth") {
    try {
      await authenticateAndSaveCredentials();
      console.error("Credentials saved. You can now run the server without the 'auth' argument.");
      process.exit(0);
    } catch (error) {
      console.error('Authentication failed:', errorMessage(error));
      process.exit(1);
    }
  } else if (process.argv[2] === "http") {
    await startHttpServer();
  } else {
    try {
      console.error('Starting MCP server...');
      const transport = new StdioServerTransport();
      await createMcpServer().connect(transport);
      console.error('MCP server started successfully.');
    } catch (error) {
      console.error('Failed to start server:', errorMessage(error));
      process.exit(1);
    }
  }
}

main().catch((error) => {
  console.error('Error in main:', errorMessage(error));
  process.exit(1);
});
