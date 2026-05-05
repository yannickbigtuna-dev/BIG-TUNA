import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomUUID } from "crypto";
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, existsSync } from "fs";
import { join, resolve, dirname, relative } from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { createServer } from "http";
import { z } from "zod";

const execAsync = promisify(exec);

const PORT       = 3001;
const ROOT       = "C:\\SERVER";
const SECRET     = process.env.MCP_SECRET;

if (!SECRET) {
  console.error("ERROR: MCP_SECRET environment variable is not set.");
  console.error("Run: set MCP_SECRET=your-token && node server.js");
  process.exit(1);
}

// ── Path safety ───────────────────────────────────────────────────────────────
function safePath(p) {
  // Accept both relative (to ROOT) and absolute paths
  const abs = resolve(p.startsWith("C:") || p.startsWith("c:") ? p : join(ROOT, p));
  if (!abs.toLowerCase().startsWith(ROOT.toLowerCase())) {
    throw new Error(`Path outside server root: ${abs}`);
  }
  return abs;
}

// ── Session store ─────────────────────────────────────────────────────────────
const transports = {};

// ── MCP server factory ────────────────────────────────────────────────────────
function buildMcpServer() {
  const server = new McpServer({ name: "yannickmorgans-server", version: "1.0.0" });

  // read_file
  server.tool(
    "read_file",
    { path: z.string().describe("File path (relative to C:\\SERVER or absolute under C:\\SERVER)") },
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
      path:    z.string().describe("File path (relative to C:\\SERVER or absolute under C:\\SERVER)"),
      content: z.string().describe("New file content"),
    },
    async ({ path: p, content }) => {
      const abs = safePath(p);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content, "utf8");
      return { content: [{ type: "text", text: `Saved: ${abs}` }] };
    }
  );

  // list_directory
  server.tool(
    "list_directory",
    { path: z.string().default(".").describe("Directory path (relative to C:\\SERVER or absolute)") },
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

  // run_command — runs in C:\SERVER, 30 s timeout
  server.tool(
    "run_command",
    { command: z.string().describe("Command to run (executed in C:\\SERVER via cmd.exe)") },
    async ({ command }) => {
      try {
        const { stdout, stderr } = await execAsync(command, {
          cwd: ROOT,
          shell: "cmd.exe",
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
        const { stdout } = await execAsync("pm2 jlist", { shell: "cmd.exe", timeout: 10000 });
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

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`\n MCP server listening on http://localhost:${PORT}/mcp`);
  console.log(` Public URL:  https://mcp.yannickmorgans.ca/mcp`);
  console.log(` Root:        ${ROOT}\n`);
});
