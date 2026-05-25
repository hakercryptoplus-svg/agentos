/**
 * MCP (Model Context Protocol) Server
 * 
 * Exposes OpenClaw tools as MCP-compatible endpoints.
 * Based on JSON-RPC 2.0 — any MCP-compatible client can connect.
 * 
 * Transport: HTTP/SSE (default) or stdio
 * 
 * Endpoints:
 *   POST /mcp/rpc      → JSON-RPC request handler
 *   GET  /mcp/tools    → List available tools
 *   GET  /mcp/sse      → SSE stream for server-push events
 */

import type { Router, Request, Response } from "express";
import { Router as createRouter } from "express";
import { runTool, MCP_TOOLS } from "./tools.js";
import { logger } from "./logger.js";

// ─── Types ─────────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

// ─── MCP Router ────────────────────────────────────────────────

export function createMCPRouter(): Router {
  const router = createRouter();

  // ── Tool listing ───────────────────────────────────────────
  router.get("/tools", (_req: Request, res: Response) => {
    res.json({
      tools: MCP_TOOLS.map((t) => ({
        name: t.name,
        description: t.description,
        category: t.category,
        inputSchema: {
          type: "object",
          properties: Object.fromEntries(
            Object.entries(t.params_schema).map(([k, v]) => [
              k,
              { type: v.type, description: v.description },
            ])
          ),
          required: Object.entries(t.params_schema)
            .filter(([, v]) => v.required)
            .map(([k]) => k),
        },
      })),
    });
  });

  // ── JSON-RPC endpoint ──────────────────────────────────────
  router.post("/rpc", async (req: Request, res: Response) => {
    const rpc = req.body as JsonRpcRequest;

    if (rpc.jsonrpc !== "2.0" || !rpc.method) {
      return res.json(rpcError(rpc.id ?? 0, -32600, "Invalid Request"));
    }

    try {
      const result = await handleRpcMethod(rpc.method, rpc.params ?? {});
      return res.json(rpcSuccess(rpc.id, result));
    } catch (err) {
      logger.error({ err, method: rpc.method }, "MCP RPC error");
      return res.json(rpcError(rpc.id, -32000, String(err)));
    }
  });

  // ── SSE stream for server-push events ─────────────────────
  const sseClients = new Set<Response>();

  router.get("/sse", (req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Access-Control-Allow-Origin", "*");

    // Send initial ping
    res.write(`data: ${JSON.stringify({ type: "connected", timestamp: Date.now() })}\n\n`);

    sseClients.add(res);

    req.on("close", () => {
      sseClients.delete(res);
    });
  });

  // ── Broadcast to SSE clients (used by agent loop) ─────────
  router.post("/sse/broadcast", (req: Request, res: Response) => {
    const event = req.body as Record<string, unknown>;
    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of sseClients) {
      client.write(data);
    }
    res.json({ clients: sseClients.size });
  });

  // ── MCP info ───────────────────────────────────────────────
  router.get("/", (_req: Request, res: Response) => {
    res.json({
      name: "AgentX MCP Server",
      version: "2.0.0",
      protocol: "MCP/1.0",
      transport: ["http", "sse"],
      tools_count: MCP_TOOLS.length,
      categories: [...new Set(MCP_TOOLS.map((t) => t.category))],
    });
  });

  return router;
}

// ─── RPC Method Handlers ───────────────────────────────────────

async function handleRpcMethod(
  method: string,
  params: Record<string, unknown>
): Promise<unknown> {
  switch (method) {
    // MCP standard methods
    case "initialize":
      return {
        protocolVersion: "1.0",
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: "AgentX", version: "2.0.0" },
      };

    case "tools/list":
      return {
        tools: MCP_TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: {
            type: "object",
            properties: t.params_schema,
            required: Object.entries(t.params_schema)
              .filter(([, v]) => v.required)
              .map(([k]) => k),
          },
        })),
      };

    case "tools/call": {
      const toolName = String(params.name ?? "");
      const toolArgs = (params.arguments ?? {}) as Record<string, unknown>;
      const result = await runTool(toolName, toolArgs);
      return {
        content: [{ type: "text", text: result.success ? result.result : `Error: ${result.error}` }],
        isError: !result.success,
      };
    }

    case "resources/list":
      return { resources: [] };

    case "ping":
      return { pong: true, timestamp: Date.now() };

    default:
      throw new Error(`Unknown method: ${method}`);
  }
}

// ─── JSON-RPC Helpers ──────────────────────────────────────────

function rpcSuccess(id: string | number, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id: string | number, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}
