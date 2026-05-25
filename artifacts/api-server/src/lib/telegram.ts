import TelegramBot from "node-telegram-bot-api";
import { logger } from "./logger.js";
import { db } from "@workspace/db";
import { sessionsTable, messagesTable, telegramLogsTable } from "@workspace/db";
import { streamChat } from "./ai.js";
import type { ChatMessage } from "./ai.js";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { buildSystemPrompt, extractAndSaveInsights, upsertMemory, getMemory } from "./memory-manager.js";
import { createCronJob, listCronJobs, deleteCronJob, initScheduler, calcNextRun } from "./scheduler.js";
import { maybeTriggerLearning } from "./learning.js";
import { runTool } from "./tools.js";

const TELEGRAM_TOKEN = "8718116507:AAFqO-5T3OTYt4jkjIWkkC-pJ2uFlnuvZ4U";
const OWNER_CHAT_ID = "7281928709";

let bot: TelegramBot | null = null;
const botStartTime = Date.now();

// Users currently being processed (prevent double processing)
const processingChats = new Set<string>();

export function startTelegramBot() {
  try {
    bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

    // Init the scheduler with our send function
    initScheduler(async (chatId, text) => {
      await safeSend(chatId, text, { parse_mode: "Markdown" });
    });

    bot.on("message", async (msg: TelegramBot.Message) => {
      const chatId = String(msg.chat.id);
      const text = (msg.text ?? "").trim();
      const username = msg.from?.username ?? msg.from?.first_name ?? "User";
      const userId = String(msg.from?.id ?? "");

      if (!text) return;
      if (processingChats.has(chatId)) return;
      processingChats.add(chatId);

      logger.info({ chatId, username, text: text.slice(0, 80) }, "Telegram message received");

      try {
        await handleMessage({ chatId, text, username, userId });
      } finally {
        processingChats.delete(chatId);
      }
    });

    bot.on("polling_error", (err: Error) => {
      logger.error({ err }, "Telegram polling error");
    });

    // Send startup greeting to owner
    setTimeout(async () => {
      const hasOnboarded = await getMemory(`ONBOARDED:${OWNER_CHAT_ID}`);
      if (!hasOnboarded) {
        await sendOnboarding(OWNER_CHAT_ID);
      }
    }, 3000);

    logger.info("Telegram bot started successfully");
  } catch (err) {
    logger.error({ err }, "Failed to start Telegram bot");
  }
}

async function handleMessage(params: { chatId: string; text: string; username: string; userId: string }) {
  const { chatId, text, username, userId } = params;
  const b = bot!;

  // ─── Commands ───────────────────────────────────────────────────
  if (text === "/start") {
    await sendOnboarding(chatId);
    return;
  }

  if (text === "/help") {
    await safeSend(chatId, getHelpText(), { parse_mode: "Markdown" });
    return;
  }

  if (text === "/memory") {
    const sys = await buildSystemPrompt(chatId);
    await safeSend(chatId, `🧠 *ذاكرتي الحالية:*\n\n${sys.slice(0, 3000)}`, { parse_mode: "Markdown" });
    return;
  }

  if (text === "/status") {
    const info = await runTool("system_info", {});
    const { getLearningStats } = await import("./learning.js");
    const stats = await getLearningStats();
    const jobs = await listCronJobs(chatId);
    const activeJobs = jobs.filter((j) => j.isActive).length;
    await safeSend(chatId,
      `${info.result}\n\n📊 *إحصائيات الوكيل*\n` +
      `• رؤى مكتسبة: ${stats.totalInsights}\n` +
      `• مهارات مطورة: ${stats.totalSkillsCreated}\n` +
      `• مهام مجدولة نشطة: ${activeJobs}`,
      { parse_mode: "Markdown" }
    );
    return;
  }

  if (text === "/crons" || text === "/tasks") {
    const jobs = await listCronJobs(chatId);
    if (jobs.length === 0) {
      await safeSend(chatId, "📅 لا توجد مهام مجدولة حالياً.\n\nاستخدم: `/schedule <المهمة> كل <الوقت>`", { parse_mode: "Markdown" });
    } else {
      const lines = jobs.map((j, i) =>
        `${i + 1}. ${j.isActive ? "✅" : "⏸️"} *${j.name}*\n   ${j.description}\n   التوقيت: \`${j.cronExpr}\`\n   ID: \`${j.id.slice(0, 8)}\``
      );
      await safeSend(chatId, `📅 *المهام المجدولة:*\n\n${lines.join("\n\n")}`, { parse_mode: "Markdown" });
    }
    return;
  }

  if (text.startsWith("/cancel ")) {
    const jobId = text.replace("/cancel ", "").trim();
    const jobs = await listCronJobs(chatId);
    const job = jobs.find((j) => j.id.startsWith(jobId));
    if (job) {
      await deleteCronJob(job.id, chatId);
      await safeSend(chatId, `✅ تم إلغاء المهمة: *${job.name}*`, { parse_mode: "Markdown" });
    } else {
      await safeSend(chatId, "❌ لم أجد هذه المهمة.");
    }
    return;
  }

  if (text === "/clear") {
    const session = await getOrCreateSession(chatId, username);
    await db.delete(messagesTable).where(eq(messagesTable.sessionId, session.id));
    await safeSend(chatId, "🗑️ تم مسح المحادثة. نبدأ من جديد!");
    return;
  }

  if (text === "/learn") {
    const session = await getOrCreateSession(chatId, username);
    await safeSend(chatId, "🧠 أبدأ دورة التعلم الذاتي...");
    await runLearningAndNotify(session.id, chatId);
    return;
  }

  // Handle inline scheduling commands
  // e.g. "ذكرني بعد ساعة بكذا" or "/schedule كل 5 دقائق أرسل تقرير السوق"
  const scheduleMatch = text.match(/(?:ذكرني|جدول|schedule)\s+(.+)/i) ||
    text.match(/كل\s+(\d+)\s+(دقيقة|ساعة|يوم)/i);

  if (text.startsWith("/schedule ") || text.includes("ذكرني") || text.includes("جدول مهمة")) {
    await handleScheduleCommand(chatId, text, username);
    return;
  }

  // ─── Regular chat ────────────────────────────────────────────────
  await handleChat({ chatId, text, username, userId });
}

async function handleChat(params: { chatId: string; text: string; username: string; userId: string }) {
  const { chatId, text, username, userId } = params;
  const b = bot!;

  const session = await getOrCreateSession(chatId, username);

  // Save user message
  await db.insert(messagesTable).values({
    id: randomUUID(),
    sessionId: session.id,
    role: "user",
    content: text,
  });

  // Get conversation history
  const history = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.sessionId, session.id))
    .orderBy(messagesTable.createdAt)
    .limit(30);

  // Build system prompt with full memory
  const systemPrompt = await buildSystemPrompt(chatId);

  const aiMessages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...history.slice(0, -1).map((m) => ({
      role: (m.role === "assistant" ? "assistant" : "user") as "user" | "assistant" | "system",
      content: m.content,
    })),
    { role: "user", content: text },
  ];

  // Send "thinking" placeholder and then stream-edit it
  await b.sendChatAction(chatId, "typing");

  // Send initial placeholder message
  const placeholderMsg = await b.sendMessage(chatId, "💭 أفكر...");
  const msgId = placeholderMsg.message_id;

  let fullContent = "";
  let lastEditContent = "";
  let lastEditTime = 0;
  const EDIT_INTERVAL = 1200; // edit every 1.2 seconds to stay under Telegram rate limits

  await streamChat(aiMessages, session.model, async (chunk) => {
    if (chunk.type === "delta" && chunk.content) {
      fullContent += chunk.content;

      const now = Date.now();
      if (now - lastEditTime > EDIT_INTERVAL && fullContent !== lastEditContent) {
        lastEditTime = now;
        lastEditContent = fullContent;
        try {
          await b.editMessageText(fullContent.slice(0, 4000) + (fullContent.length > 4000 ? "…" : "") + "\n_⌨️_", {
            chat_id: chatId,
            message_id: msgId,
            parse_mode: "Markdown",
          });
        } catch (_) {
          // Rate limit or parse error — ignore
        }
      }
    }
  });

  // Final edit with complete content
  if (fullContent) {
    try {
      if (fullContent.length <= 4000) {
        await b.editMessageText(fullContent, {
          chat_id: chatId,
          message_id: msgId,
        });
      } else {
        // Delete placeholder and send in parts
        await b.deleteMessage(chatId, msgId);
        const parts = splitMessage(fullContent);
        for (const part of parts) {
          await b.sendMessage(chatId, part);
        }
      }
    } catch (_) {
      // If editing fails, send new message
      await safeSend(chatId, fullContent);
    }
  }

  // Save assistant message
  if (fullContent) {
    await db.insert(messagesTable).values({
      id: randomUUID(),
      sessionId: session.id,
      role: "assistant",
      content: fullContent,
    });

    await db.update(sessionsTable).set({ updatedAt: new Date() }).where(eq(sessionsTable.id, session.id));
  }

  // Log
  await db.insert(telegramLogsTable).values({
    id: randomUUID(),
    chatId,
    userId,
    username,
    messageText: text,
    response: fullContent,
    sessionId: session.id,
  }).catch(() => {});

  // Extract insights and maybe trigger learning
  await extractAndSaveInsights(chatId, aiMessages);
  await maybeTriggerLearning(session.id);
}

async function handleScheduleCommand(chatId: string, text: string, username: string): Promise<void> {
  // Ask AI to parse the scheduling intent
  const parsePrompt = `من هذا الطلب: "${text}"
استخرج معلومات الجدولة بتنسيق JSON:
{
  "name": "اسم المهمة",
  "task": "ما يجب إرساله للمستخدم",
  "cron": "الصيغة (delay:N أو every:N أو daily:HH:MM)",
  "human_confirm": "رسالة تأكيد بالعربي"
}
قواعد صيغة الوقت:
- "بعد X دقيقة/ساعة" → delay:X*60 أو delay:X*3600
- "كل X دقيقة/ساعة" → every:X*60 أو every:X*3600
- "كل يوم الساعة X" → daily:HH:MM
أجب بـ JSON فقط.`;

  try {
    const { chatOnce } = await import("./ai.js");
    const aiResp = await chatOnce([{ role: "user", content: parsePrompt }]);
    const jsonMatch = aiResp.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON");

    const parsed = JSON.parse(jsonMatch[0]) as {
      name: string;
      task: string;
      cron: string;
      human_confirm: string;
    };

    const nextRun = calcNextRun(parsed.cron);
    const nextStr = nextRun ? nextRun.toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" }) : "غير محدد";

    const id = await createCronJob({
      chatId,
      name: parsed.name,
      description: parsed.task,
      cronExpr: parsed.cron,
      task: parsed.task,
    });

    await safeSend(chatId,
      `✅ *تم جدولة المهمة!*\n\n` +
      `📌 *الاسم:* ${parsed.name}\n` +
      `📝 *المهمة:* ${parsed.task}\n` +
      `⏰ *التوقيت:* ${parsed.cron}\n` +
      `🕐 *التنفيذ القادم:* ${nextStr}\n` +
      `🆔 \`${id.slice(0, 8)}\`\n\n` +
      `للإلغاء: /cancel ${id.slice(0, 8)}`,
      { parse_mode: "Markdown" }
    );
  } catch (err) {
    await safeSend(chatId,
      `⚠️ لم أفهم صيغة الجدولة. جرب:\n` +
      `• \`/schedule ذكرني بعد ساعة بمراجعة الأهداف\`\n` +
      `• \`/schedule كل 30 دقيقة أرسل تقرير الحالة\`\n` +
      `• \`/schedule كل يوم الساعة 8 أرسل ملخص اليوم\``,
      { parse_mode: "Markdown" }
    );
  }
}

async function runLearningAndNotify(sessionId: string, chatId: string): Promise<void> {
  const { runLearningCycle } = await import("./learning.js");
  await runLearningCycle(sessionId);
  await safeSend(chatId, "✅ اكتملت دورة التعلم الذاتي. راجعت أدائي واستخرجت رؤى جديدة!");
}

async function sendOnboarding(chatId: string): Promise<void> {
  const hasOnboarded = await getMemory(`ONBOARDED:${chatId}`);

  if (hasOnboarded === "true") {
    const name = await getMemory(`NOTE:${chatId}:user_name`) ?? "";
    await safeSend(chatId,
      `مرحباً مجدداً${name ? " " + name : ""}! 👋\n\n` +
      `أنا AgentX — وكيلك الذكي، جاهز للعمل.\n` +
      `اكتب /help لقائمة الأوامر أو تكلم معي مباشرة.`
    );
    return;
  }

  await safeSend(chatId,
    `مرحباً! 👋\n\n` +
    `أنا *AgentX* — وكيل ذكاء اصطناعي متقدم مبني على:\n` +
    `🦞 *OpenClaw* — تعدد القنوات، الجدولة، الأوامر\n` +
    `🤖 *Hermes* — الذاكرة الدائمة، التعلم الذاتي، المهارات\n\n` +
    `قبل أن نبدأ، أخبرني:\n` +
    `• *ما اسمك؟*\n` +
    `• *كيف تفضل أن أخاطبك؟*\n` +
    `• *ما هدفك الرئيسي الذي تريد مساعدتي فيه؟*\n\n` +
    `سأحفظ هذه المعلومات وأستخدمها في كل محادثة. 🧠`,
    { parse_mode: "Markdown" }
  );

  await upsertMemory(`ONBOARDED:${chatId}`, "true", "fact");
}

async function getOrCreateSession(chatId: string, username: string) {
  const existing = await db
    .select()
    .from(sessionsTable)
    .where(eq(sessionsTable.channel, `telegram:${chatId}`))
    .limit(1);

  if (existing.length > 0) return existing[0];

  const id = randomUUID();
  const [newSession] = await db
    .insert(sessionsTable)
    .values({
      id,
      title: `Telegram — ${username}`,
      model: "claude-opus-4-7",
      channel: `telegram:${chatId}`,
    })
    .returning();

  return newSession;
}

async function safeSend(chatId: string, text: string, opts?: TelegramBot.SendMessageOptions): Promise<void> {
  if (!bot) return;
  try {
    const parts = splitMessage(text);
    for (const part of parts) {
      await bot.sendMessage(chatId, part, opts);
    }
  } catch (err) {
    logger.error({ err, chatId }, "Failed to send Telegram message");
    try {
      // Fallback without parse_mode
      await bot.sendMessage(chatId, text.replace(/[*_`[\]()]/g, "").slice(0, 4096));
    } catch (_) {}
  }
}

function splitMessage(text: string, maxLen = 4000): string[] {
  if (text.length <= maxLen) return [text];
  const parts: string[] = [];
  while (text.length > 0) {
    parts.push(text.slice(0, maxLen));
    text = text.slice(maxLen);
  }
  return parts;
}

function getHelpText(): string {
  return `🤖 *AgentX — دليل الأوامر*

*💬 المحادثة*
فقط اكتب رسالتك وسأرد عليها مباشرة

*🧠 الذاكرة*
/memory — عرض ذاكرتي الكاملة عنك
/learn — تشغيل دورة التعلم الذاتي

*📅 الجدولة*
/tasks أو /crons — عرض المهام المجدولة
/schedule <الطلب> — جدولة مهمة جديدة
/cancel <ID> — إلغاء مهمة

*⚙️ النظام*
/status — مواصفات البيئة وإحصائيات الوكيل
/clear — مسح سجل المحادثة
/start — إعادة الترحيب
/help — هذه القائمة

*مثال على الجدولة:*
\`ذكرني بعد ساعة بمراجعة أهدافي\`
\`كل يوم الساعة 9 أرسل ملخص المهام\``;
}

export function isBotRunning(): boolean {
  return bot !== null;
}

export function getBotStartTime(): number {
  return botStartTime;
}

export async function sendTelegramMessage(chatId: string, text: string): Promise<void> {
  if (!bot) throw new Error("Bot not running");
  await safeSend(chatId, text);
}
