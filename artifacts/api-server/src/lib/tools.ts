import { logger } from "./logger.js";

export interface ToolResult {
  success: boolean;
  result: string;
  error?: string;
}

const tools: Record<string, (params: Record<string, unknown>) => Promise<ToolResult>> = {
  web_search: async (params) => {
    const query = String(params.query ?? "");
    if (!query) return { success: false, result: "", error: "query is required" };
    try {
      const res = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`);
      const data = await res.json() as { AbstractText?: string; RelatedTopics?: Array<{ Text?: string }> };
      const answer = data.AbstractText || data.RelatedTopics?.slice(0, 3).map((t) => t.Text).join("\n") || "No results found";
      return { success: true, result: answer };
    } catch (err) {
      return { success: false, result: "", error: String(err) };
    }
  },

  get_datetime: async () => {
    return { success: true, result: new Date().toISOString() };
  },

  calculate: async (params) => {
    const expr = String(params.expression ?? "");
    try {
      // Safe math eval - only allow numbers and operators
      if (!/^[0-9+\-*/().\s%^]+$/.test(expr)) {
        return { success: false, result: "", error: "Invalid expression" };
      }
      const result = Function(`"use strict"; return (${expr})`)();
      return { success: true, result: String(result) };
    } catch (err) {
      return { success: false, result: "", error: String(err) };
    }
  },

  echo: async (params) => {
    return { success: true, result: String(params.text ?? "") };
  },

  system_info: async () => {
    return {
      success: true,
      result: JSON.stringify({
        platform: process.platform,
        nodeVersion: process.version,
        uptime: process.uptime(),
        memory: process.memoryUsage(),
      }),
    };
  },

  fetch_url: async (params) => {
    const url = String(params.url ?? "");
    if (!url.startsWith("http")) {
      return { success: false, result: "", error: "Invalid URL" };
    }
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      const text = await res.text();
      return { success: true, result: text.slice(0, 2000) };
    } catch (err) {
      return { success: false, result: "", error: String(err) };
    }
  },
};

export const AVAILABLE_TOOLS = Object.keys(tools);

export async function runTool(toolName: string, params: Record<string, unknown>): Promise<ToolResult> {
  const tool = tools[toolName];
  if (!tool) {
    return { success: false, result: "", error: `Unknown tool: ${toolName}` };
  }
  try {
    logger.info({ toolName, params }, "Running tool");
    return await tool(params);
  } catch (err) {
    logger.error({ err, toolName }, "Tool execution error");
    return { success: false, result: "", error: String(err) };
  }
}
