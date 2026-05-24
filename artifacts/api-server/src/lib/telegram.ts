import TelegramBot from "node-telegram-bot-api";
import { logger } from "./logger.js";
import { db } from "@workspace/db";
import { sessionsTable, messagesTable, telegramLogsTable } from "@workspace/db";
import { chatOnce, streamChat } from "./ai.js";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

const TELEGRAM_TOKEN = "8718116507:AAFqO-5T3OTYt4jkjIWkkC-pJ2uFlnuvZ4U";
const OWNER_CHAT_ID = "7281928709";

let bot: TelegramBot | null = null;
let botStartTime = Date.now();

export function startTelegramBot() {
  try {
    bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

    bot.on("message", async (msg) => {
      const chatId = String(msg.chat.id);
      const text = msg.text ?? "";
      const username = msg.from?.username ?? msg.from?.first_name ?? "User";
      const userId = String(msg.from?.id ?? "");

      if (!text.trim()) return;

      logger.info({ chatId, username, text }, "Telegram message received");

      // Handle /start command
      if (text.startsWith("/start")) {
        await bot!.sendMessage(chatId, 
          `👋 مرحباً ${username}!\n\nأنا وكيل ذكاء اصطناعي متقدم مبني على:\n• 🦞 OpenClaw — التواصل متعدد القنوات\n• 🤖 Hermes — الذاكرة والمهارات الذاتية\n\nأستطيع:\n✅ الإجابة على أسئلتك\n✅ تذكر تفضيلاتك\n✅ تنفيذ أوامر متقدمة\n\nابدأ بإرسال رسالتك! 🚀`
        );
        return;
      }

      // Handle /memory command
      if (text.startsWith("/memory")) {
        const memories = await db.select().from(messagesTable)
          .where(eq(messagesTable.role, "user"))
          .limit(5);
        const memText = memories.length > 0
          ? memories.map((m) => `• ${m.content.slice(0, 60)}...`).join("\n")
          : "لا توجد ذاكرة بعد";
        await bot!.sendMessage(chatId, `🧠 آخر رسائلك:\n${memText}`);
        return;
      }

      // Handle /help command
      if (text.startsWith("/help")) {
        await bot!.sendMessage(chatId,
          `📖 *الأوامر المتاحة:*\n\n/start - بدء المحادثة\n/memory - عرض الذاكرة\n/clear - مسح المحادثة\n/help - المساعدة\n\nأو فقط أرسل رسالتك مباشرة! 💬`,
          { parse_mode: "Markdown" }
        );
        return;
      }

      // Handle /clear command
      if (text.startsWith("/clear")) {
        await bot!.sendMessage(chatId, "✅ تم مسح المحادثة. ابدأ من جديد!");
        return;
      }

      // Get or create session for this chat
      let session = await db.select().from(sessionsTable)
        .where(eq(sessionsTable.channel, `telegram:${chatId}`))
        .limit(1);

      let sessionId: string;
      if (session.length === 0) {
        sessionId = randomUUID();
        await db.insert(sessionsTable).values({
          id: sessionId,
          title: `Telegram - ${username}`,
          model: "claude-opus-4-7",
          channel: `telegram:${chatId}`,
          systemPrompt: "أنت وكيل ذكاء اصطناعي متقدم. أجب دائماً بنفس لغة المستخدم. كن مفيداً ومختصراً وودوداً.",
        });
      } else {
        sessionId = session[0].id;
      }

      // Get conversation history
      const history = await db.select().from(messagesTable)
        .where(eq(messagesTable.sessionId, sessionId))
        .limit(20);

      // Save user message
      await db.insert(messagesTable).values({
        id: randomUUID(),
        sessionId,
        role: "user",
        content: text,
      });

      // Send typing indicator
      await bot!.sendChatAction(chatId, "typing");

      // Build messages array
      const aiMessages = [
        {
          role: "system" as const,
          content: "أنت وكيل ذكاء اصطناعي متقدم مبني على ميزات OpenClaw وHermes. أجب دائماً بنفس لغة المستخدم. كن مفيداً ودقيقاً.",
        },
        ...history.map((m) => ({
          role: (m.role === "assistant" ? "assistant" : "user") as "user" | "assistant" | "system",
          content: m.content,
        })),
        { role: "user" as const, content: text },
      ];

      try {
        const response = await chatOnce(aiMessages);

        // Save assistant response
        await db.insert(messagesTable).values({
          id: randomUUID(),
          sessionId,
          role: "assistant",
          content: response,
        });

        // Log to telegram_logs
        await db.insert(telegramLogsTable).values({
          id: randomUUID(),
          chatId,
          userId,
          username,
          messageText: text,
          response,
          sessionId,
        });

        // Send response (split if too long)
        const maxLen = 4000;
        if (response.length <= maxLen) {
          await bot!.sendMessage(chatId, response);
        } else {
          const parts = response.match(/.{1,4000}/gs) ?? [response];
          for (const part of parts) {
            await bot!.sendMessage(chatId, part);
          }
        }
      } catch (err) {
        logger.error({ err }, "Error getting AI response for Telegram");
        await bot!.sendMessage(chatId, "⚠️ حدث خطأ. يرجى المحاولة مرة أخرى.");
      }
    });

    bot.on("polling_error", (err) => {
      logger.error({ err }, "Telegram polling error");
    });

    logger.info("Telegram bot started successfully");
  } catch (err) {
    logger.error({ err }, "Failed to start Telegram bot");
  }
}

export function isBotRunning(): boolean {
  return bot !== null;
}

export function getBotStartTime(): number {
  return botStartTime;
}

export async function sendTelegramMessage(chatId: string, text: string): Promise<void> {
  if (!bot) throw new Error("Bot not running");
  await bot.sendMessage(chatId, text);
}
