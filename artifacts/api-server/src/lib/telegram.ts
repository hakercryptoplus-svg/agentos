/**
 * Telegram Bot — OpenClaw + Hermes style
 *
 * Features:
 * - Progressive message editing during AI streaming
 * - OpenClaw-style tool execution display (shows exactly what's running)
 * - SubAgent spawning
 * - Cron job scheduling
 * - Hermes persistent memory
 * - Self-learning loop
 */

import TelegramBot from "node-telegram-bot-api";
import { logger } from "./logger.js";
import { db } from "@workspace/db";
import {
  sessionsTable,
  messagesTable,
  telegramLogsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import {
  buildSystemPrompt,
  extractAndSaveInsights,
  upsertMemory,
  getMemory,
  getAllMemory,
} from "./memory-manager.js";
import {
  createCronJob,
  listCronJobs,
  deleteCronJob,
  initScheduler,
  calcNextRun,
} from "./scheduler.js";
import { maybeTriggerLearning } from "./learning.js";
import { runAgentLoop, runSubAgent } from "./agent-loop.js";
import type { AgentStage } from "./agent-loop.js";

const TELEGRAM_TOKEN = "8718116507:AAFqO-5T3OTYt4jkjIWkkC-pJ2uFlnuvZ4U";
const OWNER_CHAT_ID = "7281928709";

let bot: TelegramBot | null = null;
const botStartTime = Date.now();

// Prevent concurrent processing per chat
const processingChats = new Set<string>();

// ─────────────────────────────────────────────────────────────
// STARTUP
// ─────────────────────────────────────────────────────────────

export function startTelegramBot(): void {
  try {
    bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

    initScheduler(async (chatId: string, text: string) => {
      await rawSend(chatId, text);
    });

    bot.on("message", async (msg: TelegramBot.Message) => {
      const chatId = String(msg.chat.id);
      const text = (msg.text ?? "").trim();
      const username =
        msg.from?.username ?? msg.from?.first_name ?? "User";
      const userId = String(msg.from?.id ?? "");

      if (!text) return;
      if (processingChats.has(chatId)) {
        await rawSend(chatId, "⏳ لا تزال رسالتك السابقة قيد المعالجة...");
        return;
      }

      processingChats.add(chatId);
      logger.info({ chatId, username, text: text.slice(0, 80) }, "msg in");

      try {
        await handleMessage({ chatId, text, username, userId });
      } catch (err) {
        logger.error({ err, chatId }, "Unhandled error in handleMessage");
        await rawSend(chatId, "⚠️ حدث خطأ غير متوقع. حاول مرة أخرى.");
      } finally {
        processingChats.delete(chatId);
      }
    });

    bot.on("polling_error", (err: Error) => {
      logger.error({ err }, "Telegram polling error");
    });

    // Onboard owner on first start
    setTimeout(async () => {
      const done = await getMemory(`ONBOARDED:${OWNER_CHAT_ID}`);
      if (!done) await sendOnboarding(OWNER_CHAT_ID);
    }, 3500);

    logger.info("Telegram bot started");
  } catch (err) {
    logger.error({ err }, "Failed to start Telegram bot");
  }
}

// ─────────────────────────────────────────────────────────────
// MESSAGE ROUTER
// ─────────────────────────────────────────────────────────────

async function handleMessage(p: {
  chatId: string;
  text: string;
  username: string;
  userId: string;
}): Promise<void> {
  const { chatId, text, username } = p;

  if (text === "/start") { await sendOnboarding(chatId); return; }
  if (text === "/help") { await rawSend(chatId, helpText()); return; }
  if (text === "/status") { await cmdStatus(chatId); return; }
  if (text === "/memory") { await cmdMemory(chatId); return; }
  if (text === "/learn") { await cmdLearn(chatId); return; }
  if (text === "/clear") { await cmdClear(chatId); return; }
  if (text === "/tasks" || text === "/crons") { await cmdTasks(chatId); return; }
  if (text.startsWith("/cancel ")) {
    await cmdCancel(chatId, text.replace("/cancel ", "").trim());
    return;
  }
  if (text.startsWith("/schedule ")) {
    await cmdSchedule(chatId, text.replace("/schedule ", "").trim(), username);
    return;
  }
  if (text.startsWith("/subagent ")) {
    await cmdSubagent(chatId, text.replace("/subagent ", "").trim());
    return;
  }

  // Natural language scheduling detection
  if (
    /ذكرني|جدول|كل\s+\d+\s+(دقيق|ساع)|كل\s+يوم/u.test(text) &&
    text.length < 200
  ) {
    await cmdSchedule(chatId, text, username);
    return;
  }

  // Regular chat with agent loop
  await handleChat(p);
}

// ─────────────────────────────────────────────────────────────
// MAIN CHAT — AGENT LOOP WITH LIVE DISPLAY
// ─────────────────────────────────────────────────────────────

async function handleChat(p: {
  chatId: string;
  text: string;
  username: string;
  userId: string;
}): Promise<void> {
  const { chatId, text, username, userId } = p;
  const b = bot!;

  const session = await getOrCreateSession(chatId, username);

  // Save user message
  await db.insert(messagesTable).values({
    id: randomUUID(),
    sessionId: session.id,
    role: "user",
    content: text,
  });

  // Load history (last 25 messages)
  const historyRows = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.sessionId, session.id))
    .orderBy(messagesTable.createdAt)
    .limit(25);

  const history = historyRows.slice(0, -1).map((m) => ({
    role: (m.role === "assistant" ? "assistant" : "user") as
      | "user"
      | "assistant"
      | "system",
    content: m.content,
  }));

  // Send initial "thinking" placeholder — PLAIN TEXT only
  await b.sendChatAction(chatId, "typing");
  let liveMsg = await b.sendMessage(chatId, "⏳ أعمل على طلبك...");
  const liveId = liveMsg.message_id;

  // Track display state
  let displayLines: string[] = ["⏳ أعمل على طلبك..."];
  let lastEditTime = 0;
  const EDIT_THROTTLE = 1500; // ms between edits

  async function updateDisplay(newLines: string[]): Promise<void> {
    displayLines = newLines;
    const now = Date.now();
    if (now - lastEditTime < EDIT_THROTTLE) return;
    lastEditTime = now;
    await safeEdit(chatId, liveId, displayLines.join("\n"));
  }

  // Progress handler — OpenClaw-style live display
  async function onProgress(stage: AgentStage): Promise<void> {
    switch (stage.type) {
      case "thinking":
        await updateDisplay([`⏳ ${stage.message}`]);
        await b.sendChatAction(chatId, "typing");
        break;

      case "tool_start": {
        const icon = toolIcon(stage.toolName ?? "");
        const lines = [
          ...displayLines.filter((l) => !l.startsWith("⏳")),
          `${icon} تنفيذ: ${stage.toolName}`,
          `   ↳ ${fmtParams(stage.toolParams ?? "")}`,
          `   ⏳ جاري التنفيذ...`,
        ];
        await updateDisplay(lines);
        await b.sendChatAction(chatId, "typing");
        break;
      }

      case "tool_result": {
        // Replace last "جاري التنفيذ..." with result
        const icon = toolIcon(stage.toolName ?? "");
        const result = (stage.toolResult ?? "").slice(0, 300);
        const updated = displayLines
          .filter((l) => !l.includes("جاري التنفيذ..."))
          .concat([`   ✅ النتيجة: ${result}`]);
        await updateDisplay(updated);
        break;
      }

      case "tool_error": {
        const updated = displayLines
          .filter((l) => !l.includes("جاري التنفيذ..."))
          .concat([`   ❌ خطأ: ${stage.message}`]);
        await updateDisplay(updated);
        break;
      }

      case "subagent": {
        const lines = [
          ...displayLines.filter((l) => !l.startsWith("⏳")),
          `🤖 وكيل فرعي: ${stage.message.slice(0, 60)}`,
        ];
        await updateDisplay(lines);
        break;
      }

      case "error":
        await safeEdit(chatId, liveId, `❌ ${stage.message}`);
        break;

      case "done":
        await b.sendChatAction(chatId, "typing");
        break;
    }
  }

  // Run agent loop
  let agentResult: { content: string; toolsUsed: string[]; iterations: number };
  try {
    agentResult = await runAgentLoop({
      userMessage: text,
      chatId,
      history,
      model: session.model,
      onProgress,
    });
  } catch (err) {
    logger.error({ err }, "Agent loop failed");
    await safeEdit(chatId, liveId, "⚠️ حدث خطأ. يرجى المحاولة مرة أخرى.");
    return;
  }

  const finalContent = agentResult.content || "تم تنفيذ الطلب.";

  // ── Build final display message ──────────────────────────
  // Show tool execution summary + final response
  const toolSummary =
    agentResult.toolsUsed.length > 0
      ? `\n\n─── الأدوات المستخدمة ───\n${agentResult.toolsUsed
          .map((t) => `${toolIcon(t)} ${t}`)
          .join("  ")}`
      : "";

  const finalDisplay = finalContent + toolSummary;

  // Edit or replace the live message with the final answer
  await forceEdit(chatId, liveId, finalDisplay);

  // Save assistant message to DB
  await db.insert(messagesTable).values({
    id: randomUUID(),
    sessionId: session.id,
    role: "assistant",
    content: finalContent,
  });

  await db
    .update(sessionsTable)
    .set({ updatedAt: new Date() })
    .where(eq(sessionsTable.id, session.id));

  // Log to telegram_logs
  await db
    .insert(telegramLogsTable)
    .values({
      id: randomUUID(),
      chatId,
      userId,
      username,
      messageText: text,
      response: finalContent,
      sessionId: session.id,
    })
    .catch(() => {});

  // Background: extract insights + trigger learning
  setImmediate(async () => {
    await extractAndSaveInsights(chatId, history);
    await maybeTriggerLearning(session.id);
  });
}

// ─────────────────────────────────────────────────────────────
// COMMANDS
// ─────────────────────────────────────────────────────────────

async function cmdStatus(chatId: string): Promise<void> {
  const os = await import("os");
  const cpus = os.cpus();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  const { getLearningStats } = await import("./learning.js");
  const stats = await getLearningStats();
  const jobs = await listCronJobs(chatId);

  const text =
    `🖥 مواصفات البيئة الحقيقية\n\n` +
    `المعالج: ${cpus[0]?.model ?? "N/A"}\n` +
    `النوى: ${cpus.length} cores\n` +
    `الذاكرة: ${(usedMem / 1024 ** 3).toFixed(1)}GB / ${(totalMem / 1024 ** 3).toFixed(1)}GB\n` +
    `نظام التشغيل: ${os.platform()} ${os.arch()}\n` +
    `Node.js: ${process.version}\n` +
    `وقت التشغيل: ${fmtUptime(os.uptime())}\n\n` +
    `📊 إحصائيات الوكيل\n\n` +
    `الرؤى المكتسبة: ${stats.totalInsights}\n` +
    `المهارات المطورة: ${stats.totalSkillsCreated}\n` +
    `المهام المجدولة: ${jobs.filter((j) => j.isActive).length}\n` +
    `وقت تشغيل الوكيل: ${fmtUptime((Date.now() - botStartTime) / 1000)}`;

  await rawSend(chatId, text);
}

async function cmdMemory(chatId: string): Promise<void> {
  const all = await getAllMemory();
  const userKeys = Object.entries(all).filter(([k]) =>
    k.includes(chatId) || ["MEMORY.md", "SOUL.md", "PERSONALITY.md"].includes(k)
  );

  if (userKeys.length === 0) {
    await rawSend(chatId, "🧠 الذاكرة فارغة حتى الآن.");
    return;
  }

  const text =
    `🧠 ذاكرتي عنك\n\n` +
    userKeys
      .map(([k, v]) => `${k.replace(`NOTE:${chatId}:`, "").replace(`ONBOARDED:${chatId}`, "onboarded")}:\n  ${v.slice(0, 100)}`)
      .join("\n\n");

  await rawSend(chatId, text.slice(0, 4000));
}

async function cmdLearn(chatId: string): Promise<void> {
  const session = await getOrCreateSession(chatId, "user");
  await rawSend(chatId, "🧠 بدأت دورة التعلم الذاتي...");
  const { runLearningCycle } = await import("./learning.js");
  await runLearningCycle(session.id);
  await rawSend(chatId, "✅ اكتملت دورة التعلم! راجعت أدائي واستخرجت رؤى جديدة.");
}

async function cmdClear(chatId: string): Promise<void> {
  const session = await getOrCreateSession(chatId, "user");
  await db.delete(messagesTable).where(eq(messagesTable.sessionId, session.id));
  await rawSend(chatId, "🗑 تم مسح المحادثة. نبدأ من جديد!");
}

async function cmdTasks(chatId: string): Promise<void> {
  const jobs = await listCronJobs(chatId);
  if (jobs.length === 0) {
    await rawSend(
      chatId,
      "📅 لا توجد مهام مجدولة.\n\nمثال:\n/schedule ذكرني بعد ساعة بمراجعة الأهداف"
    );
    return;
  }

  const lines = jobs.map((j, i) => {
    const status = j.isActive ? "✅" : "⏸";
    const next = j.nextRunAt
      ? j.nextRunAt.toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" })
      : "—";
    return `${i + 1}. ${status} ${j.name}\n   ${j.description}\n   التنفيذ القادم: ${next}\n   ID: ${j.id.slice(0, 8)}`;
  });

  await rawSend(chatId, `📅 المهام المجدولة:\n\n${lines.join("\n\n")}`);
}

async function cmdCancel(chatId: string, idPrefix: string): Promise<void> {
  const jobs = await listCronJobs(chatId);
  const job = jobs.find((j) => j.id.startsWith(idPrefix));
  if (!job) {
    await rawSend(chatId, "❌ لم أجد هذه المهمة. استخدم /tasks لعرض القائمة.");
    return;
  }
  await deleteCronJob(job.id, chatId);
  await rawSend(chatId, `✅ تم إلغاء المهمة: ${job.name}`);
}

async function cmdSchedule(chatId: string, text: string, username: string): Promise<void> {
  const { chatOnce } = await import("./ai.js");

  const parsePrompt = `من هذا النص: "${text}"
استخرج معلومات الجدولة. أجب بـ JSON فقط:
{
  "name": "اسم قصير للمهمة",
  "task": "ما يجب إرساله بالضبط للمستخدم عند التنفيذ",
  "cron": "صيغة التوقيت",
  "human_time": "وصف الوقت بالعربي"
}
صيغ التوقيت المتاحة:
- بعد X دقيقة → delay:X*60  (مثلاً بعد 5 دقائق → delay:300)
- بعد X ساعة → delay:X*3600  (مثلاً بعد ساعة → delay:3600)
- كل X دقيقة → every:X*60
- كل X ساعة → every:X*3600
- كل يوم الساعة HH:MM → daily:HH:MM
أجب بـ JSON صحيح فقط بدون أي نص إضافي.`;

  const liveId = (await rawSend(chatId, "⏳ أحلل طلب الجدولة...")).message_id;

  try {
    const aiResp = await chatOnce([{ role: "user", content: parsePrompt }]);
    const jsonMatch = aiResp.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("no JSON");

    const parsed = JSON.parse(jsonMatch[0]) as {
      name: string;
      task: string;
      cron: string;
      human_time: string;
    };

    const nextRun = calcNextRun(parsed.cron);
    const nextStr = nextRun
      ? nextRun.toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" })
      : "غير محدد";

    const id = await createCronJob({
      chatId,
      name: parsed.name,
      description: parsed.task,
      cronExpr: parsed.cron,
      task: parsed.task,
    });

    await forceEdit(
      chatId,
      liveId,
      `✅ تم جدولة المهمة!\n\n` +
        `الاسم: ${parsed.name}\n` +
        `المهمة: ${parsed.task}\n` +
        `الوقت: ${parsed.human_time}\n` +
        `التنفيذ القادم: ${nextStr}\n` +
        `ID: ${id.slice(0, 8)}\n\n` +
        `للإلغاء: /cancel ${id.slice(0, 8)}`
    );
  } catch (err) {
    await forceEdit(
      chatId,
      liveId,
      `⚠️ لم أفهم صيغة الجدولة. جرب:\n` +
        `/schedule ذكرني بعد ساعة بمراجعة الأهداف\n` +
        `/schedule كل 30 دقيقة أرسل تقرير\n` +
        `/schedule كل يوم الساعة 9:00 أرسل ملخص اليوم`
    );
  }
}

async function cmdSubagent(chatId: string, task: string): Promise<void> {
  const liveMsg = await rawSend(chatId, `🤖 وكيل فرعي يعمل على: ${task.slice(0, 60)}...`);
  const liveId = liveMsg.message_id;

  const result = await runSubAgent({
    task,
    chatId,
    onProgress: async (stage) => {
      if (stage.type === "tool_start") {
        await safeEdit(chatId, liveId, `🤖 وكيل فرعي\n${toolIcon(stage.toolName ?? "")} ${stage.toolName}: ${fmtParams(stage.toolParams ?? "")}`);
      }
    },
  });

  await forceEdit(chatId, liveId, `🤖 نتيجة الوكيل الفرعي:\n\n${result}`);
}

// ─────────────────────────────────────────────────────────────
// ONBOARDING
// ─────────────────────────────────────────────────────────────

async function sendOnboarding(chatId: string): Promise<void> {
  const already = await getMemory(`ONBOARDED:${chatId}`);

  if (already === "true") {
    const name = (await getMemory(`NOTE:${chatId}:user_name`)) ?? "";
    await rawSend(
      chatId,
      `مرحباً مجدداً${name ? " " + name : ""}!\n\n` +
        `أنا AgentX — وكيلك الذكي جاهز للعمل.\n` +
        `اكتب /help لقائمة الأوامر أو تكلم معي مباشرة.`
    );
    return;
  }

  await upsertMemory(`ONBOARDED:${chatId}`, "true", "fact");

  await rawSend(
    chatId,
    `مرحباً! 👋\n\n` +
      `أنا AgentX — وكيل ذكاء اصطناعي متقدم يجمع:\n` +
      `🦞 OpenClaw — تعدد القنوات، الجدولة، عرض التنفيذ الحي\n` +
      `🤖 Hermes — ذاكرة دائمة، تعلم ذاتي، مهارات قابلة للكتابة\n\n` +
      `قبل أن نبدأ، أخبرني:\n` +
      `• ما اسمك؟ وكيف تحب أن أخاطبك؟\n` +
      `• ما هدفك الرئيسي الذي تريد مساعدتي فيه؟\n` +
      `• ما شخصيتي التي تفضلها؟ (رسمي / ودي / مباشر)\n\n` +
      `سأحفظ كل هذا وأستخدمه في كل محادثة. 🧠\n\n` +
      `اكتب /help لقائمة الأوامر الكاملة.`
  );
}

// ─────────────────────────────────────────────────────────────
// DB HELPERS
// ─────────────────────────────────────────────────────────────

async function getOrCreateSession(chatId: string, username: string) {
  const [existing] = await db
    .select()
    .from(sessionsTable)
    .where(eq(sessionsTable.channel, `telegram:${chatId}`))
    .limit(1);

  if (existing) return existing;

  const id = randomUUID();
  const [row] = await db
    .insert(sessionsTable)
    .values({
      id,
      title: `Telegram — ${username}`,
      model: "claude-opus-4-7",
      channel: `telegram:${chatId}`,
    })
    .returning();

  return row;
}

// ─────────────────────────────────────────────────────────────
// TELEGRAM SEND / EDIT HELPERS — BULLETPROOF
// ─────────────────────────────────────────────────────────────

/**
 * rawSend — always plain text, always works
 */
async function rawSend(
  chatId: string,
  text: string
): Promise<TelegramBot.Message> {
  const b = bot!;
  const parts = chunkText(text);
  let last!: TelegramBot.Message;
  for (const part of parts) {
    try {
      last = await b.sendMessage(chatId, part);
    } catch (err) {
      logger.error({ err, chatId }, "rawSend failed");
      // Try with stripped text
      try {
        last = await b.sendMessage(chatId, part.replace(/[^\w\s\n.,!?؟،]/g, "").slice(0, 4096));
      } catch (_) {}
    }
  }
  return last!;
}

/**
 * safeEdit — edit with plain text only, never fails
 */
async function safeEdit(
  chatId: string,
  msgId: number,
  text: string
): Promise<void> {
  const b = bot!;
  const content = text.slice(0, 4096);
  try {
    await b.editMessageText(content, {
      chat_id: chatId,
      message_id: msgId,
      // NO parse_mode — plain text is bulletproof
    });
  } catch (err: unknown) {
    // Ignore "message is not modified" (error 400) — this is fine
    const msg = String(err);
    if (msg.includes("not modified")) return;
    logger.warn({ chatId, msgId, err }, "safeEdit failed (non-critical)");
  }
}

/**
 * forceEdit — edit the live message with final content.
 * If content is too long, delete placeholder and send in chunks.
 */
async function forceEdit(
  chatId: string,
  msgId: number,
  text: string
): Promise<void> {
  const b = bot!;

  if (text.length <= 4096) {
    // Try to edit first
    try {
      await b.editMessageText(text, {
        chat_id: chatId,
        message_id: msgId,
      });
      return;
    } catch (err: unknown) {
      const msg = String(err);
      if (msg.includes("not modified")) return;
      // Edit failed — fall through to delete + send
      logger.warn({ chatId, msgId }, "forceEdit: edit failed, will delete+send");
    }
  }

  // Delete placeholder and send fresh
  try {
    await b.deleteMessage(chatId, msgId);
  } catch (_) {}

  for (const chunk of chunkText(text)) {
    await rawSend(chatId, chunk);
  }
}

function chunkText(text: string, maxLen = 4000): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    // Try to split at a newline near the boundary
    let end = maxLen;
    const nl = remaining.lastIndexOf("\n", maxLen);
    if (nl > maxLen * 0.7) end = nl + 1;
    chunks.push(remaining.slice(0, end));
    remaining = remaining.slice(end);
  }
  return chunks;
}

// ─────────────────────────────────────────────────────────────
// UI HELPERS
// ─────────────────────────────────────────────────────────────

function toolIcon(name: string): string {
  const icons: Record<string, string> = {
    web_search: "🔍",
    fetch_url: "🌐",
    calculate: "🔢",
    get_datetime: "🕐",
    system_info: "🖥",
    memory_read: "🧠",
    memory_write: "💾",
    schedule_task: "📅",
    list_tasks: "📋",
  };
  return icons[name] ?? "⚙️";
}

function fmtParams(raw: string): string {
  try {
    const p = JSON.parse(raw);
    const entries = Object.entries(p);
    if (entries.length === 0) return "";
    return entries.map(([k, v]) => `${k}="${String(v).slice(0, 60)}"`).join(", ");
  } catch {
    return raw.slice(0, 80);
  }
}

function fmtUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return [d && `${d}d`, h && `${h}h`, m && `${m}m`].filter(Boolean).join(" ") || "< 1m";
}

function helpText(): string {
  return (
    `AgentX — دليل الأوامر\n\n` +
    `💬 المحادثة\n` +
    `فقط اكتب رسالتك — الوكيل يفكر ويستخدم الأدوات تلقائياً\n\n` +
    `⚙️ الأدوات المتاحة (تلقائية)\n` +
    `🔍 web_search  🌐 fetch_url  🔢 calculate\n` +
    `🕐 get_datetime  🖥 system_info\n` +
    `🧠 memory_read  💾 memory_write  📅 schedule_task\n\n` +
    `🤖 الوكيل الفرعي\n` +
    `/subagent <مهمة> — تفويض مهمة لوكيل منفصل\n\n` +
    `📅 الجدولة\n` +
    `/schedule <الطلب> — جدولة مهمة\n` +
    `/tasks — عرض المهام\n` +
    `/cancel <ID> — إلغاء مهمة\n\n` +
    `🧠 الذاكرة والتعلم\n` +
    `/memory — عرض الذاكرة\n` +
    `/learn — دورة تعلم ذاتي\n` +
    `/clear — مسح المحادثة\n\n` +
    `📊 النظام\n` +
    `/status — مواصفات البيئة + إحصائيات\n` +
    `/start — إعادة التهيئة\n\n` +
    `مثال جدولة:\n` +
    `ذكرني بعد ساعة بمراجعة أهدافي\n` +
    `كل يوم الساعة 9:00 أرسل ملخص المهام`
  );
}

// ─────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────

export function isBotRunning(): boolean {
  return bot !== null;
}

export function getBotStartTime(): number {
  return botStartTime;
}

export async function sendTelegramMessage(
  chatId: string,
  text: string
): Promise<void> {
  await rawSend(chatId, text);
}
