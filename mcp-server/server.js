import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomUUID } from "crypto";
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "fs";
import { dirname } from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { createServer } from "http";
import { z } from "zod";
import { runtimeConfig, createSafePath } from './platform.js';

const execAsync = promisify(exec);

const PORT       = 3001;
const { root: ROOT, shell: COMMAND_SHELL, host: HOST } = runtimeConfig();
const SECRET     = process.env.MCP_SECRET;

if (!SECRET) {
  console.error("ERROR: MCP_SECRET environment variable is not set.");
  console.error("Run: set MCP_SECRET=your-token && node server.js");
  process.exit(1);
}

// ── Path safety ───────────────────────────────────────────────────────────────
const safePath = createSafePath(ROOT);

// ── Session store ─────────────────────────────────────────────────────────────
const transports = {};

// ── MCP server factory ────────────────────────────────────────────────────────
function buildMcpServer() {
  const server = new McpServer({ name: "yannickmorgans-server", version: "1.0.0" });

  // read_file
  server.tool(
    "read_file",
    { path: z.string().describe("File path relative to the configured server root, or absolute within it") },
    async ({ path: p }) => {
      const abs = safePath(p);
      const content = readFileSync(abs, "utf8");
      return { content: [{ type: "text", text: content }] };
    }
  );

  // write_file
  server.tool(
    "write_file",
    {
      path:    z.string().describe("File path relative to the configured server root, or absolute within it"),
      content: z.string().describe("New file content"),
    },
    async ({ path: p, content }) => {
      const abs = safePath(p);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(safePath(p), content, "utf8");
      return { content: [{ type: "text", text: `Saved: ${abs}` }] };
    }
  );

  // list_directory
  server.tool(
    "list_directory",
    { path: z.string().default(".").describe("Directory path relative to the configured server root, or absolute within it") },
    async ({ path: p }) => {
      const abs = safePath(p);
      const entries = readdirSync(abs, { withFileTypes: true });
      const lines = entries.map(e => {
        const prefix = e.isDirectory() ? "DIR  " : "FILE ";
        return `${prefix} ${e.name}`;
      });
      return { content: [{ type: "text", text: lines.join("\n") || "(empty)" }] };
    }
  );

  // Commands remain owner-authorized shell access with a 30 s timeout.
  server.tool(
    "run_command",
    { command: z.string().describe("Shell command to run in the configured server root") },
    async ({ command }) => {
      try {
        const { stdout, stderr } = await execAsync(command, {
          cwd: ROOT,
          shell: COMMAND_SHELL,
          timeout: 30000,
          windowsHide: true,
        });
        const out = (stdout + stderr).trim() || "(no output)";
        return { content: [{ type: "text", text: out }] };
      } catch (err) {
        const out = [err.message, err.stdout, err.stderr].filter(Boolean).join("\n").trim();
        return { content: [{ type: "text", text: `Error:\n${out}` }] };
      }
    }
  );

  // server_status — quick health check
  server.tool(
    "server_status",
    {},
    async () => {
      try {
        const { stdout } = await execAsync("pm2 jlist", { cwd: ROOT, shell: COMMAND_SHELL, timeout: 10000, windowsHide: true });
        const procs = JSON.parse(stdout || "[]").map(p =>
          `${p.name}: ${p.pm2_env.status} (pid ${p.pid}, restarts ${p.pm2_env.restart_time})`
        );
        return { content: [{ type: "text", text: procs.join("\n") || "No pm2 processes found" }] };
      } catch (err) {
        return { content: [{ type: "text", text: `pm2 unavailable: ${err.message}` }] };
      }
    }
  );

  return server;
}

// ── HTTP server ───────────────────────────────────────────────────────────────
const httpServer = createServer((req, res) => {
  // CORS preflight
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, mcp-session-id");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  const path = new URL(req.url, `http://localhost:${PORT}`).pathname;
  if (path !== "/mcp") { res.writeHead(404); res.end("Not found"); return; }

  // Unauthenticated GET with no session ID = discovery probe (claude.ai connector check)
  if (req.method === "GET" && !req.headers["mcp-session-id"]) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ name: "yannickmorgans-server", version: "1.0.0", protocol: "mcp" }));
    return;
  }

  // All other requests require auth
  const auth = (req.headers["authorization"] || "");
  if (!auth.startsWith("Bearer ") || auth.slice(7) !== SECRET) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }

  if (req.method === "POST") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", async () => {
      try {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => { transports[sid] = transport; },
        });
        transport.onclose = () => {
          if (transport.sessionId) delete transports[transport.sessionId];
        };
        const server = buildMcpServer();
        await server.connect(transport);
        await transport.handleRequest(req, res, JSON.parse(body || "{}"));
      } catch (err) {
        console.error("MCP POST error:", err.message);
        if (!res.headersSent) { res.writeHead(500); res.end(err.message); }
      }
    });
    return;
  }

  if (req.method === "GET") {
    const sid = req.headers["mcp-session-id"];
    const t = sid && transports[sid];
    if (!t) { res.writeHead(404); res.end("Session not found"); return; }
    t.handleRequest(req, res).catch(err => {
      console.error("MCP GET error:", err.message);
      if (!res.headersSent) { res.writeHead(500); res.end(err.message); }
    });
    return;
  }

  if (req.method === "DELETE") {
    const sid = req.headers["mcp-session-id"];
    const t = sid && transports[sid];
    if (!t) { res.writeHead(404); res.end("Session not found"); return; }
    t.handleRequest(req, res).catch(() => {}).finally(() => { delete transports[sid]; });
    return;
  }

  res.writeHead(405); res.end("Method not allowed");
});

httpServer.listen(PORT, HOST, () => {
  console.log(`\n MCP server listening on http://localhost:${PORT}/mcp`);
  console.log(` Public URL:  https://mcp.yannickmorgans.ca/mcp`);
  console.log(` Root:        ${ROOT}\n`);
});
