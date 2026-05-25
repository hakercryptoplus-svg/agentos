/**
 * OpenClaw-style MCP Tools
 * 
 * Tools are organized into MCP-compatible categories:
 * - browser  (web_search, fetch_url)
 * - memory   (memory_read, memory_write, memory_search)
 * - media    (image_analyze)
 * - system   (get_datetime, system_info, calculate)
 * - files    (file_read, file_list)
 * - skills   (execute_skill, list_skills)
 * - schedule (schedule_task, list_tasks, delete_task)
 */

import os from "os";
import { logger } from "./logger.js";

export interface ToolResult {
  success: boolean;
  result: string;
  error?: string;
}

// ─── MCP Tool Schema ───────────────────────────────────────────

export interface MCPTool {
  name: string;
  description: string;
  category: "browser" | "memory" | "media" | "system" | "files" | "skills" | "schedule";
  params_schema: Record<string, { type: string; description: string; required?: boolean }>;
}

export const MCP_TOOLS: MCPTool[] = [
  {
    name: "web_search",
    category: "browser",
    description: "البحث على الإنترنت عن معلومات حالية",
    params_schema: {
      query: { type: "string", description: "استعلام البحث", required: true },
    },
  },
  {
    name: "fetch_url",
    category: "browser",
    description: "جلب محتوى صفحة ويب",
    params_schema: {
      url: { type: "string", description: "رابط URL كامل يبدأ بـ https://", required: true },
    },
  },
  {
    name: "image_analyze",
    category: "media",
    description: "تحليل صورة بالتفصيل — يستخدم تلقائياً عند إرسال صورة",
    params_schema: {
      image_base64: { type: "string", description: "الصورة بصيغة base64", required: true },
      question: { type: "string", description: "السؤال المتعلق بالصورة" },
      mime_type: { type: "string", description: "نوع الصورة (image/jpeg, image/png, ...)" },
    },
  },
  {
    name: "memory_read",
    category: "memory",
    description: "قراءة من الذاكرة الدائمة",
    params_schema: {
      key: { type: "string", description: "مفتاح الذاكرة (فارغ = كل الذاكرة)" },
    },
  },
  {
    name: "memory_write",
    category: "memory",
    description: "الكتابة في الذاكرة الدائمة",
    params_schema: {
      key: { type: "string", description: "مفتاح الذاكرة", required: true },
      value: { type: "string", description: "القيمة للحفظ", required: true },
      category: { type: "string", description: "التصنيف (general, fact, preference, note)" },
    },
  },
  {
    name: "memory_search",
    category: "memory",
    description: "البحث في الذاكرة بكلمة مفتاحية",
    params_schema: {
      query: { type: "string", description: "كلمة البحث", required: true },
    },
  },
  {
    name: "memory_delete",
    category: "memory",
    description: "حذف مفتاح من الذاكرة",
    params_schema: {
      key: { type: "string", description: "المفتاح المراد حذفه", required: true },
    },
  },
  {
    name: "get_datetime",
    category: "system",
    description: "الوقت والتاريخ الحاليين",
    params_schema: {},
  },
  {
    name: "calculate",
    category: "system",
    description: "حساب تعبيرات رياضية",
    params_schema: {
      expression: { type: "string", description: "التعبير الرياضي", required: true },
    },
  },
  {
    name: "system_info",
    category: "system",
    description: "معلومات النظام والخادم",
    params_schema: {},
  },
  {
    name: "schedule_task",
    category: "schedule",
    description: "جدولة مهمة دورية أو مرة واحدة",
    params_schema: {
      chatId: { type: "string", description: "معرّف الدردشة", required: true },
      name: { type: "string", description: "اسم المهمة", required: true },
      task: { type: "string", description: "ما يجب فعله", required: true },
      cron: { type: "string", description: "التوقيت (every:3600 أو cron: 0 9 * * *)" },
    },
  },
  {
    name: "list_tasks",
    category: "schedule",
    description: "قائمة المهام المجدولة",
    params_schema: {
      chatId: { type: "string", description: "معرّف الدردشة", required: true },
    },
  },
  {
    name: "delete_task",
    category: "schedule",
    description: "حذف مهمة مجدولة",
    params_schema: {
      jobId: { type: "string", description: "معرّف المهمة", required: true },
    },
  },
  {
    name: "execute_skill",
    category: "skills",
    description: "تشغيل مهارة بالاسم",
    params_schema: {
      skill_name: { type: "string", description: "اسم المهارة", required: true },
      input: { type: "string", description: "المدخل للمهارة" },
    },
  },
  {
    name: "list_skills",
    category: "skills",
    description: "قائمة المهارات المتاحة",
    params_schema: {},
  },
];

// ─── Tool Implementations ──────────────────────────────────────

const tools: Record<string, (params: Record<string, unknown>) => Promise<ToolResult>> = {

  // ── Browser Tools ──────────────────────────────────────────

  web_search: async (params) => {
    const query = String(params.query ?? "");
    if (!query) return { success: false, result: "", error: "query مطلوب" };
    try {
      // Try Brave Search API first if available, fallback to DuckDuckGo
      const res = await fetch(
        `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
        { signal: AbortSignal.timeout(8000) }
      );
      const data = await res.json() as {
        AbstractText?: string;
        AbstractURL?: string;
        RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>;
        Answer?: string;
      };

      const parts: string[] = [];
      if (data.Answer) parts.push(`**الإجابة المباشرة:** ${data.Answer}`);
      if (data.AbstractText) parts.push(`**الملخص:** ${data.AbstractText}\n${data.AbstractURL ? `المصدر: ${data.AbstractURL}` : ""}`);
      if (data.RelatedTopics?.length) {
        const topics = data.RelatedTopics.slice(0, 5)
          .map((t) => t.Text)
          .filter(Boolean)
          .join("\n- ");
        if (topics) parts.push(`**نتائج ذات صلة:**\n- ${topics}`);
      }

      return {
        success: true,
        result: parts.length > 0 ? parts.join("\n\n") : "لم تُعثر على نتائج مباشرة. جرب صياغة مختلفة.",
      };
    } catch (err) {
      return { success: false, result: "", error: String(err) };
    }
  },

  fetch_url: async (params) => {
    const url = String(params.url ?? "");
    if (!url.startsWith("http")) return { success: false, result: "", error: "URL يجب أن يبدأ بـ http" };
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(12000),
        headers: {
          "User-Agent": "Mozilla/5.0 AgentX/2.0",
          Accept: "text/html,application/xhtml+xml",
        },
      });
      const text = await res.text();
      // Clean HTML
      const clean = text
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      return { success: true, result: clean.slice(0, 4000) };
    } catch (err) {
      return { success: false, result: "", error: String(err) };
    }
  },

  // ── Media Tools ────────────────────────────────────────────

  image_analyze: async (params) => {
    const imageBase64 = String(params.image_base64 ?? "");
    const question = String(params.question ?? "صف ما تراه في هذه الصورة بالتفصيل");
    const mimeType = String(params.mime_type ?? "image/jpeg");

    if (!imageBase64) return { success: false, result: "", error: "image_base64 مطلوب" };

    try {
      const { chatWithVision } = await import("./ai.js");
      const result = await chatWithVision(imageBase64, mimeType, question);
      return { success: true, result };
    } catch (err) {
      return { success: false, result: "", error: `فشل تحليل الصورة: ${String(err)}` };
    }
  },

  // ── Memory Tools ────────────────────────────────────────────

  memory_read: async (params) => {
    const { getMemory, getAllMemory } = await import("./memory-manager.js");
    const key = String(params.key ?? "");
    if (key) {
      const val = await getMemory(key);
      return { success: true, result: val ?? "(لا يوجد)" };
    }
    const all = await getAllMemory();
    const filtered = Object.entries(all)
      .filter(([k]) => !k.startsWith("SKILL:"))
      .slice(0, 30)
      .map(([k, v]) => `**${k}:** ${v.slice(0, 150)}`)
      .join("\n");
    return { success: true, result: filtered || "(الذاكرة فارغة)" };
  },

  memory_write: async (params) => {
    const { upsertMemory } = await import("./memory-manager.js");
    const key = String(params.key ?? "");
    const value = String(params.value ?? "");
    const category = String(params.category ?? "general");
    if (!key || !value) return { success: false, result: "", error: "key و value مطلوبان" };
    await upsertMemory(key, value, category);
    return { success: true, result: `✅ تم الحفظ: ${key}` };
  },

  memory_search: async (params) => {
    const { searchMemory } = await import("./memory-manager.js");
    const query = String(params.query ?? "");
    if (!query) return { success: false, result: "", error: "query مطلوب" };
    const results = await searchMemory(query);
    if (results.length === 0) return { success: true, result: "لا نتائج تطابق البحث" };
    return {
      success: true,
      result: results.map((r) => `**${r.key}:** ${r.value.slice(0, 200)}`).join("\n\n"),
    };
  },

  memory_delete: async (params) => {
    const { deleteMemory } = await import("./memory-manager.js");
    const key = String(params.key ?? "");
    if (!key) return { success: false, result: "", error: "key مطلوب" };
    await deleteMemory(key);
    return { success: true, result: `✅ تم حذف: ${key}` };
  },

  // ── System Tools ────────────────────────────────────────────

  get_datetime: async () => {
    const now = new Date();
    return {
      success: true,
      result: JSON.stringify({
        iso: now.toISOString(),
        arabic: now.toLocaleString("ar-SA", { timeZone: "Asia/Riyadh", dateStyle: "full", timeStyle: "medium" }),
        unix: Math.floor(now.getTime() / 1000),
        timezone: "Asia/Riyadh",
        day_of_week: now.toLocaleDateString("ar-SA", { weekday: "long", timeZone: "Asia/Riyadh" }),
      }, null, 2),
    };
  },

  calculate: async (params) => {
    const expr = String(params.expression ?? "");
    if (!expr) return { success: false, result: "", error: "expression مطلوب" };
    try {
      const result = Function(`"use strict"; return (${expr})`)();
      return { success: true, result: `${expr} = ${result}` };
    } catch (err) {
      return { success: false, result: "", error: `خطأ رياضي: ${String(err)}` };
    }
  },

  system_info: async () => {
    const cpus = os.cpus();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    return {
      success: true,
      result: [
        `🖥️ **مواصفات البيئة**`,
        `**المعالج:** ${cpus[0]?.model ?? "Unknown"} × ${cpus.length} نوى`,
        `**الذاكرة:** ${(usedMem / 1024 ** 3).toFixed(2)} GB / ${(totalMem / 1024 ** 3).toFixed(2)} GB (${((usedMem / totalMem) * 100).toFixed(0)}%)`,
        `**النظام:** ${os.platform()} ${os.release()} ${os.arch()}`,
        `**وقت التشغيل:** ${formatUptime(os.uptime())}`,
        `**Node.js:** ${process.version}`,
        `**التحميل:** ${os.loadavg().map((l) => l.toFixed(2)).join(" / ")}`,
      ].join("\n"),
    };
  },

  echo: async (params) => ({ success: true, result: String(params.text ?? "") }),

  // ── Schedule Tools ──────────────────────────────────────────

  schedule_task: async (params) => {
    const { createCronJob } = await import("./scheduler.js");
    const chatId = String(params.chatId ?? "");
    const name = String(params.name ?? "مهمة");
    const task = String(params.task ?? "");
    const cronExpr = String(params.cron ?? "every:3600");
    if (!task || !chatId) return { success: false, result: "", error: "chatId و task مطلوبان" };
    const id = await createCronJob({ chatId, name, description: name, cronExpr, task });
    return { success: true, result: `✅ جُدولت المهمة "${name}" بمعرّف: ${id}` };
  },

  list_tasks: async (params) => {
    const { listCronJobs } = await import("./scheduler.js");
    const chatId = String(params.chatId ?? "");
    if (!chatId) return { success: false, result: "", error: "chatId مطلوب" };
    const jobs = await listCronJobs(chatId);
    if (jobs.length === 0) return { success: true, result: "لا توجد مهام مجدولة" };
    return {
      success: true,
      result: jobs.map((j) =>
        `[${j.isActive ? "✅" : "⏸️"}] **${j.name}** (${j.cronExpr})\nالمعرّف: ${j.id}`
      ).join("\n\n"),
    };
  },

  delete_task: async (params) => {
    const { deleteCronJob } = await import("./scheduler.js");
    const jobId = String(params.jobId ?? "");
    if (!jobId) return { success: false, result: "", error: "jobId مطلوب" };
    await deleteCronJob(jobId);
    return { success: true, result: `✅ تم حذف المهمة: ${jobId}` };
  },

  // ── Skills Tools ────────────────────────────────────────────

  execute_skill: async (params) => {
    const { getSkillPrompt } = await import("./skills-manager.js");
    const skillName = String(params.skill_name ?? "");
    if (!skillName) return { success: false, result: "", error: "skill_name مطلوب" };
    const content = await getSkillPrompt(skillName);
    if (!content) return { success: false, result: "", error: `المهارة "${skillName}" غير موجودة أو معطّلة` };
    return { success: true, result: `تم تحميل مهارة "${skillName}":\n${content.slice(0, 1000)}` };
  },

  list_skills: async () => {
    const { listSkills } = await import("./skills-manager.js");
    const skills = await listSkills();
    if (skills.length === 0) return { success: true, result: "لا توجد مهارات مثبّتة" };
    return {
      success: true,
      result: skills.map((s) =>
        `${s.enabled ? "✅" : "⏸️"} **${s.name}**: ${s.description}`
      ).join("\n"),
    };
  },
};

// ─── Helper ─────────────────────────────────────────────────

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
    return {
      success: false,
      result: "",
      error: `أداة غير معروفة: "${toolName}". المتاحة: ${AVAILABLE_TOOLS.join(", ")}`,
    };
  }
  try {
    logger.info({ toolName, params: Object.keys(params) }, "MCP tool called");
    return await tool(params);
  } catch (err) {
    logger.error({ err, toolName }, "Tool error");
    return { success: false, result: "", error: String(err) };
  }
}
