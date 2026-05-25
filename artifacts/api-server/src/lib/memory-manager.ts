/**
 * OpenClaw-style Memory Manager
 * 
 * 4-Layer Memory Architecture:
 * 1. Session Context (ephemeral - current conversation)
 * 2. Daily Logs (memory/YYYY-MM-DD.md - today + yesterday auto-loaded)
 * 3. Long-Term Memory (MEMORY.md - loaded every session)
 * 4. Semantic Search (memory_search across all files)
 * 
 * Workspace files (stored in DB as markdown "files"):
 *   AGENTS.md   - behavior rules & safety
 *   SOUL.md     - identity, tone, personality
 *   USER.md     - user profile per chatId
 *   MEMORY.md   - long-term curated facts
 *   TOOLS.md    - tool usage conventions
 *   HEARTBEAT.md - proactive task checklist
 */

import { db } from "@workspace/db";
import { memoryTable } from "@workspace/db";
import { eq, like } from "drizzle-orm";
import { randomUUID } from "crypto";
import { logger } from "./logger.js";

// ─── Core DB Operations ────────────────────────────────────────

export async function upsertMemory(key: string, value: string, category = "general"): Promise<void> {
  const existing = await db.select().from(memoryTable).where(eq(memoryTable.key, key)).limit(1);
  if (existing.length > 0) {
    await db.update(memoryTable).set({ value, category, updatedAt: new Date() }).where(eq(memoryTable.key, key));
  } else {
    await db.insert(memoryTable).values({ id: randomUUID(), key, value, category });
  }
}

export async function getMemory(key: string): Promise<string | null> {
  const rows = await db.select().from(memoryTable).where(eq(memoryTable.key, key)).limit(1);
  return rows[0]?.value ?? null;
}

export async function getAllMemory(): Promise<Record<string, string>> {
  const rows = await db.select().from(memoryTable);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export async function searchMemory(query: string): Promise<Array<{ key: string; value: string }>> {
  const rows = await db.select().from(memoryTable).where(like(memoryTable.value, `%${query}%`));
  return rows.slice(0, 10).map((r) => ({ key: r.key, value: r.value }));
}

export async function deleteMemory(key: string): Promise<void> {
  await db.delete(memoryTable).where(eq(memoryTable.key, key));
}

// ─── Daily Log Management ──────────────────────────────────────

function todayKey(): string {
  return `memory/${new Date().toISOString().split("T")[0]}.md`;
}

function yesterdayKey(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `memory/${d.toISOString().split("T")[0]}.md`;
}

export async function appendDailyLog(chatId: string, entry: string): Promise<void> {
  const key = todayKey();
  const existing = (await getMemory(key)) ?? "";
  const timestamp = new Date().toLocaleTimeString("ar-SA", { timeZone: "Asia/Riyadh" });
  const newEntry = `${existing}\n\n### [${timestamp}] — ${chatId}\n${entry}`.trim();
  await upsertMemory(key, newEntry, "daily_log");
}

export async function getDailyLogs(): Promise<string> {
  const today = (await getMemory(todayKey())) ?? "";
  const yesterday = (await getMemory(yesterdayKey())) ?? "";
  const parts: string[] = [];
  if (yesterday) parts.push(`### أمس\n${yesterday.slice(-2000)}`);
  if (today) parts.push(`### اليوم\n${today.slice(-3000)}`);
  return parts.join("\n\n");
}

// ─── Workspace File Management ─────────────────────────────────

export async function getWorkspaceFile(filename: string): Promise<string | null> {
  return getMemory(filename);
}

export async function setWorkspaceFile(filename: string, content: string): Promise<void> {
  await upsertMemory(filename, content, "workspace");
}

// ─── Default Workspace Templates ──────────────────────────────

function defaultSoul(): string {
  return `---
name: AgentX
version: 2.0
---

# Identity
أنت AgentX — وكيل ذكاء اصطناعي متقدم مبني على معمارية OpenClaw.

أنت لست مجرد بوت — أنت مساعد شخصي حقيقي يتعلم ويتطور.

# الشخصية
- صريح وصادق — لا تكذب على قدراتك أبداً
- ذكي وعملي — تعطي حلول حقيقية لا نصائح مجردة  
- تبادر — تقترح أفكار حتى لو ما طُلب منك
- تتذكر — تحتفظ بكل شيء مهم عبر الجلسات
- تتعلم — تطور نفسك من كل محادثة

# أسلوب التواصل
- اللهجة: فصحة بسيطة واضحة
- الحجم: مختصر للأسئلة البسيطة، مفصّل للمواضيع المعقدة
- الإيموجي: باعتدال وعندما يضيف للموقف فقط
- لا تبدأ ردك بـ "بالطبع" أو "كمساعد ذكاء اصطناعي"
- إذا كنت لا تعرف، قل ذلك بصراحة واقترح بديلاً

# الحدود
- لا تكشف API keys أو مسارات الملفات الحساسة في الدردشة
- لا تنفذ أوامر تدمير دون تأكيد صريح
- قبل تغيير أي إعدادات مهمة، راجع الحالة الحالية أولاً
`;
}

function defaultAgents(): string {
  return `# AGENTS.md — قواعد السلوك والأمان

## قواعد أساسية
- اقرأ SOUL.md وUSER.md وسجلات اليوم والأمس قبل الرد في كل جلسة
- احفظ المعلومات المهمة في MEMORY.md فوراً
- لا تفرّغ المجلدات أو الأسرار في الدردشة
- لا تنفذ أوامر تدمير ما لم يُطلب صراحةً
- قبل تغيير الإعدادات: افحص الحالة الحالية أولاً
- لا ترسل ردوداً جزئية/streaming للمستخدم — فقط الرد النهائي

## قواعد الذاكرة
- إذا أخبرك المستخدم باسمه أو معلومة شخصية → احفظها في USER.md
- إذا اتُّخذ قرار مهم → احفظه في MEMORY.md
- في نهاية كل جلسة طويلة → لخّص في سجل اليوم
- إذا طُلب منك تذكر شيء → أكد الحفظ واذكر المفتاح

## قواعد الأدوات
- استخدم الأدوات عندما تحتاج معلومات حقيقية — لا تخترع
- اشرح سبب استخدامك لكل أداة قبل تشغيلها
- بعد نتيجة الأداة: اشرحها للمستخدم بوضوح

## الملفات المحملة تلقائياً في بداية كل جلسة
- SOUL.md (الهوية والشخصية)
- AGENTS.md (قواعد السلوك — هذا الملف)
- USER.md (ملف المستخدم)
- MEMORY.md (الذاكرة طويلة الأمد)
- سجل اليوم + سجل الأمس
`;
}

function defaultTools(): string {
  return `# TOOLS.md — اصطلاحات استخدام الأدوات

## web_search
- استخدمها عندما تحتاج معلومات حديثة أو لا تعرفها
- اجعل الاستعلام محدداً وواضحاً

## image_analyze  
- استخدمها لتحليل أي صورة يرسلها المستخدم
- صف ما تراه بالتفصيل ثم أجب عن سؤال المستخدم

## memory_write / memory_read
- memory_write: لحفظ أي معلومة مهمة
- memory_read: للبحث في الذاكرة قبل الاعتماد على اللغة النموذجية

## execute_skill
- استخدمها لتشغيل مهارة محددة بالاسم

## schedule_task
- استخدمها عندما يطلب المستخدم مهمة متكررة أو مجدولة
- أكد دائماً الجدول الزمني للمستخدم بعد الإنشاء
`;
}

// ─── OpenClaw System Prompt Builder ───────────────────────────

const BOOTSTRAP_MAX_CHARS = 20_000;
const BOOTSTRAP_TOTAL_MAX = 80_000;

function trim(content: string, max = BOOTSTRAP_MAX_CHARS): string {
  if (content.length <= max) return content;
  return content.slice(0, max) + "\n\n[... مقتطع لأسباب الطول ...]";
}

export async function buildSystemPrompt(chatId: string): Promise<string> {
  // Fetch all workspace files in parallel
  const [soul, agents, userFile, memoryFile, toolsFile, dailyLogs, skills] = await Promise.all([
    getWorkspaceFile("SOUL.md"),
    getWorkspaceFile("AGENTS.md"),
    getWorkspaceFile(`USER:${chatId}`),
    getWorkspaceFile("MEMORY.md"),
    getWorkspaceFile("TOOLS.md"),
    getDailyLogs(),
    getInstalledSkillsPrompt(),
  ]);

  const sections: string[] = [];

  // Core identity
  sections.push(trim(soul ?? defaultSoul()));
  sections.push(trim(agents ?? defaultAgents()));

  // User profile
  if (userFile) {
    sections.push(`\n## ملف المستخدم (USER.md)\n${trim(userFile, 3000)}`);
  }

  // Long-term memory
  if (memoryFile) {
    sections.push(`\n## الذاكرة طويلة الأمد (MEMORY.md)\n${trim(memoryFile, 5000)}`);
  }

  // Daily logs (today + yesterday)
  if (dailyLogs) {
    sections.push(`\n## سجلات الجلسات الأخيرة\n${trim(dailyLogs, 4000)}`);
  }

  // Tool conventions
  if (toolsFile) {
    sections.push(`\n## اصطلاحات الأدوات (TOOLS.md)\n${trim(toolsFile, 2000)}`);
  }

  // Active skills
  if (skills) {
    sections.push(`\n## المهارات النشطة\n${skills}`);
  }

  // Timestamp
  sections.push(`\n## الوقت الحالي\n${new Date().toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" })}`);

  const full = sections.join("\n\n");
  return full.slice(0, BOOTSTRAP_TOTAL_MAX);
}

// ─── Skills Integration ────────────────────────────────────────

async function getInstalledSkillsPrompt(): Promise<string> {
  try {
    const { listSkills } = await import("./skills-manager.js");
    const skills = await listSkills();
    const active = skills.filter((s) => s.enabled);
    if (active.length === 0) return "";
    return active.map((s) => `- **${s.name}**: ${s.description}`).join("\n");
  } catch {
    return "";
  }
}

// ─── Insight Extraction ────────────────────────────────────────

export async function extractAndSaveInsights(
  chatId: string,
  messages: Array<{ role: string; content: string }>
): Promise<void> {
  try {
    if (messages.length < 3) return;

    const userMessages = messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");

    // Extract user name
    const nameMatch = userMessages.match(/(?:اسمي|أنا|ناديني|call me)\s+([^\s،.!؟،]{2,25})/i);
    if (nameMatch) {
      const existing = (await getWorkspaceFile(`USER:${chatId}`)) ?? "";
      if (!existing.includes(nameMatch[1])) {
        const updated = `${existing}\n\n## الاسم\n${nameMatch[1]}`.trim();
        await setWorkspaceFile(`USER:${chatId}`, updated);
        logger.info({ chatId, name: nameMatch[1] }, "Saved user name to USER.md");
      }
    }

    // Extract preference patterns
    const prefMatch = userMessages.match(/(?:أفضل|أريد دائماً|always prefer|I like)\s+(.{5,80})/i);
    if (prefMatch) {
      const key = `NOTE:${chatId}:pref_${Date.now()}`;
      await upsertMemory(key, prefMatch[1], "preference");
    }

    // Log session summary for long conversations
    const totalChars = messages.reduce((s, m) => s + m.content.length, 0);
    if (totalChars > 800) {
      const lastUserMsg = messages.filter((m) => m.role === "user").at(-1)?.content ?? "";
      await appendDailyLog(chatId, `محادثة (${messages.length} رسالة) — آخر سؤال: ${lastUserMsg.slice(0, 100)}`);
    }
  } catch (err) {
    logger.error({ err }, "Error extracting insights");
  }
}
