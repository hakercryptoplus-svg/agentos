import os from "os";
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
      const answer = data.AbstractText || data.RelatedTopics?.slice(0, 5).map((t) => t.Text).filter(Boolean).join("\n") || "No results found";
      return { success: true, result: answer };
    } catch (err) {
      return { success: false, result: "", error: String(err) };
    }
  },

  get_datetime: async () => {
    const now = new Date();
    return {
      success: true,
      result: JSON.stringify({
        iso: now.toISOString(),
        local: now.toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" }),
        unix: Math.floor(now.getTime() / 1000),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    };
  },

  calculate: async (params) => {
    const expr = String(params.expression ?? "");
    try {
      if (!/^[0-9+\-*/().\s%,]+$/.test(expr.replace(/[a-zA-Z]/g, ""))) {
        return { success: false, result: "", error: "Invalid expression characters" };
      }
      const result = Function(`"use strict"; return (${expr})`)();
      return { success: true, result: String(result) };
    } catch (err) {
      return { success: false, result: "", error: String(err) };
    }
  },

  system_info: async () => {
    const cpus = os.cpus();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    const info = {
      platform: os.platform(),
      os_release: os.release(),
      architecture: os.arch(),
      hostname: os.hostname(),
      cpu_model: cpus[0]?.model ?? "Unknown",
      cpu_cores: cpus.length,
      cpu_speed_mhz: cpus[0]?.speed ?? 0,
      cpu_usage_percent: cpus.map((c) => {
        const total = Object.values(c.times).reduce((a, b) => a + b, 0);
        const idle = c.times.idle;
        return (((total - idle) / total) * 100).toFixed(1) + "%";
      }),
      total_ram_gb: (totalMem / 1024 ** 3).toFixed(2),
      used_ram_gb: (usedMem / 1024 ** 3).toFixed(2),
      free_ram_gb: (freeMem / 1024 ** 3).toFixed(2),
      ram_usage_percent: ((usedMem / totalMem) * 100).toFixed(1) + "%",
      uptime_seconds: Math.floor(os.uptime()),
      uptime_human: formatUptime(os.uptime()),
      node_version: process.version,
      load_average: os.loadavg().map((l) => l.toFixed(2)),
      network_interfaces: Object.keys(os.networkInterfaces()),
    };

    return {
      success: true,
      result: `🖥️ *مواصفات البيئة الفعلية*\n\n` +
        `**المعالج:** ${info.cpu_model}\n` +
        `**النوى:** ${info.cpu_cores} cores @ ${info.cpu_speed_mhz} MHz\n` +
        `**الذاكرة الكلية:** ${info.total_ram_gb} GB\n` +
        `**الذاكرة المستخدمة:** ${info.used_ram_gb} GB (${info.ram_usage_percent})\n` +
        `**الذاكرة الحرة:** ${info.free_ram_gb} GB\n` +
        `**نظام التشغيل:** ${info.platform} ${info.os_release}\n` +
        `**المعمارية:** ${info.architecture}\n` +
        `**وقت التشغيل:** ${info.uptime_human}\n` +
        `**متوسط التحميل:** ${info.load_average.join(" / ")}\n` +
        `**Node.js:** ${info.node_version}`,
    };
  },

  echo: async (params) => {
    return { success: true, result: String(params.text ?? "") };
  },

  fetch_url: async (params) => {
    const url = String(params.url ?? "");
    if (!url.startsWith("http")) {
      return { success: false, result: "", error: "Invalid URL — must start with http" };
    }
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(10000),
        headers: { "User-Agent": "AgentX/1.0" },
      });
      const text = await res.text();
      // Strip HTML tags for cleaner output
      const clean = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      return { success: true, result: clean.slice(0, 3000) };
    } catch (err) {
      return { success: false, result: "", error: String(err) };
    }
  },

  memory_read: async (params) => {
    const { getMemory, getAllMemory } = await import("./memory-manager.js");
    const key = String(params.key ?? "");
    if (key) {
      const val = await getMemory(key);
      return { success: true, result: val ?? "(not found)" };
    }
    const all = await getAllMemory();
    const text = Object.entries(all).map(([k, v]) => `${k}: ${v.slice(0, 100)}`).join("\n");
    return { success: true, result: text || "(empty memory)" };
  },

  memory_write: async (params) => {
    const { upsertMemory } = await import("./memory-manager.js");
    const key = String(params.key ?? "");
    const value = String(params.value ?? "");
    const category = String(params.category ?? "general");
    if (!key || !value) return { success: false, result: "", error: "key and value required" };
    await upsertMemory(key, value, category);
    return { success: true, result: `Saved: ${key}` };
  },

  schedule_task: async (params) => {
    const { createCronJob } = await import("./scheduler.js");
    const chatId = String(params.chatId ?? "7281928709");
    const name = String(params.name ?? "Task");
    const task = String(params.task ?? "");
    const cronExpr = String(params.cron ?? "delay:3600");
    if (!task) return { success: false, result: "", error: "task required" };
    const id = await createCronJob({ chatId, name, description: name, cronExpr, task });
    return { success: true, result: `Task scheduled with ID: ${id}` };
  },

  list_tasks: async (params) => {
    const { listCronJobs } = await import("./scheduler.js");
    const chatId = String(params.chatId ?? "7281928709");
    const jobs = await listCronJobs(chatId);
    if (jobs.length === 0) return { success: true, result: "No scheduled tasks" };
    const text = jobs.map((j) => `[${j.isActive ? "✅" : "⏸️"}] ${j.name}: ${j.description} (${j.cronExpr})`).join("\n");
    return { success: true, result: text };
  },
};

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  return parts.join(" ") || "< 1m";
}

export const AVAILABLE_TOOLS = Object.keys(tools);

export async function runTool(toolName: string, params: Record<string, unknown>): Promise<ToolResult> {
  const tool = tools[toolName];
  if (!tool) {
    return { success: false, result: "", error: `Unknown tool: ${toolName}. Available: ${AVAILABLE_TOOLS.join(", ")}` };
  }
  try {
    logger.info({ toolName, params }, "Running tool");
    return await tool(params);
  } catch (err) {
    logger.error({ err, toolName }, "Tool execution error");
    return { success: false, result: "", error: String(err) };
  }
}
