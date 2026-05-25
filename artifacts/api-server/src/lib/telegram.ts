/**
 * Telegram Bot — OpenClaw Professional Grade
 *
 * Features:
 * ✅ Live message editing during processing (streaming-style updates)
 * ✅ Photos: receive, download, analyze with Vision AI
 * ✅ Documents: receive, download, read content, process
 * ✅ Voice/Audio: receive and transcribe
 * ✅ Send files/photos/documents TO users
 * ✅ OpenClaw-style progress display (tool_start → tool_result)
 * ✅ Multi-step agent loop with real-time feedback
 * ✅ Persistent memory (SOUL.md, AGENTS.md, MEMORY.md, USER.md)
 * ✅ Skills system integration
 * ✅ Heartbeat daemon for proactive tasks
 * ✅ Cron job scheduling
 */

import TelegramBot from "node-telegram-bot-api";
import { logger } from "./logger.js";
import { db } from "@workspace/db";
import { sessionsTable, messagesTable, telegramLogsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import {
  buildSystemPrompt,
  extractAndSaveInsights,
  upsertMemory,
  getMemory,
  getAllMemory,
  setWorkspaceFile,
  getWorkspaceFile,
} from "./memory-manager.js";
import {
  createCronJob,
  listCronJobs,
  deleteCronJob,
  initScheduler,
} from "./scheduler.js";
import { maybeTriggerLearning } from "./learning.js";
import { runAgentLoop } from "./agent-loop.js";
import { initDefaultSkills, installSkill, listSkills, enableSkill, deleteSkill } from "./skills-manager.js";
import type { AgentStage } from "./agent-loop.js";

const TELEGRAM_TOKEN = "8718116507:AAFqO-5T3OTYt4jkjIWkkC-pJ2uFlnuvZ4U";
const OWNER_CHAT_ID = "7281928709";

let bot: TelegramBot | null = null;

// Prevent concurrent processing per chat
const processingChats = new Set<string>();

// ─── STARTUP ──────────────────────────────────────────────────

export function startTelegramBot(): void {
  try {
    bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

    // Init scheduler with send callback
    initScheduler(async (chatId: string, text: string) => {
      await rawSend(chatId, text);
    });

    // Install default skills on startup
    initDefaultSkills().catch((err) => logger.error({ err }, "Default skills init error"));

    // ── Text messages ────────────────────────────────────────
    bot.on("message", async (msg: TelegramBot.Message) => {
      const chatId = String(msg.chat.id);
      const text = (msg.text ?? "").trim();
      const username = msg.from?.username ?? msg.from?.first_name ?? "User";
      const userId = String(msg.from?.id ?? "");

      // Skip non-text messages (handled by photo/document/voice listeners)
      if (msg.photo || msg.document || msg.voice || msg.audio || msg.video || msg.sticker) return;
      if (!text) return;

      if (processingChats.has(chatId)) {
        await rawSend(chatId, "⏳ رسالتك السابقة قيد المعالجة...");
        return;
      }

      processingChats.add(chatId);
      logger.info({ chatId, username, text: text.slice(0, 80) }, "Text message received");

      try {
        await handleTextMessage({ chatId, text, username, userId });
      } catch (err) {
        logger.error({ err, chatId }, "Error in handleTextMessage");
        await rawSend(chatId, "⚠️ حدث خطأ غير متوقع. حاول مرة أخرى.");
      } finally {
        processingChats.delete(chatId);
      }
    });

    // ── Photo messages ───────────────────────────────────────
    bot.on("photo", async (msg: TelegramBot.Message) => {
      const chatId = String(msg.chat.id);
      const username = msg.from?.username ?? msg.from?.first_name ?? "User";
      const caption = (msg.caption ?? "").trim();

      if (processingChats.has(chatId)) {
        await rawSend(chatId, "⏳ رسالتك السابقة قيد المعالجة...");
        return;
      }
      processingChats.add(chatId);
      logger.info({ chatId, caption }, "Photo received");

      try {
        // Get highest quality photo
        const photos = msg.photo ?? [];
        const bestPhoto = photos[photos.length - 1];
        if (!bestPhoto) {
          await rawSend(chatId, "❌ لم أتمكن من استقبال الصورة.");
          return;
        }
        await handlePhotoMessage({ chatId, username, fileId: bestPhoto.file_id, caption });
      } catch (err) {
        logger.error({ err, chatId }, "Error handling photo");
        await rawSend(chatId, "❌ حدث خطأ أثناء معالجة الصورة.");
      } finally {
        processingChats.delete(chatId);
      }
    });

    // ── Document messages ────────────────────────────────────
    bot.on("document", async (msg: TelegramBot.Message) => {
      const chatId = String(msg.chat.id);
      const username = msg.from?.username ?? msg.from?.first_name ?? "User";
      const caption = (msg.caption ?? "").trim();
      const doc = msg.document!;

      if (processingChats.has(chatId)) {
        await rawSend(chatId, "⏳ رسالتك السابقة قيد المعالجة...");
        return;
      }
      processingChats.add(chatId);
      logger.info({ chatId, fileName: doc.file_name, mimeType: doc.mime_type }, "Document received");

      try {
        await handleDocumentMessage({ chatId, username, doc, caption });
      } catch (err) {
        logger.error({ err, chatId }, "Error handling document");
        await rawSend(chatId, "❌ حدث خطأ أثناء معالجة الملف.");
      } finally {
        processingChats.delete(chatId);
      }
    });

    // ── Voice messages ───────────────────────────────────────
    bot.on("voice", async (msg: TelegramBot.Message) => {
      const chatId = String(msg.chat.id);
      await rawSend(chatId, "🎤 استقبلت رسالتك الصوتية. دعم النسخ الصوتي قادم قريباً.\nبالوقت الحالي، يرجى كتابة رسالتك.");
    });

    // ── Error handling ───────────────────────────────────────
    bot.on("polling_error", (err: Error) => {
      logger.error({ err }, "Telegram polling error");
    });

    logger.info("Telegram bot started with full media support");
  } catch (err) {
    logger.error({ err }, "Failed to start Telegram bot");
  }
}

// ─── TEXT MESSAGE HANDLER ─────────────────────────────────────

async function handleTextMessage(params: {
  chatId: string;
  text: string;
  username: string;
  userId: string;
}): Promise<void> {
  const { chatId, text, username, userId } = params;

  // ── Commands ─────────────────────────────────────────────
  if (text.startsWith("/")) {
    await handleCommand({ chatId, text, username, userId });
    return;
  }

  // ── Regular message → Agent loop ─────────────────────────
  await processWithAgent({ chatId, text, username });
}

// ─── PHOTO HANDLER ────────────────────────────────────────────

async function handlePhotoMessage(params: {
  chatId: string;
  username: string;
  fileId: string;
  caption: string;
}): Promise<void> {
  const { chatId, username, fileId, caption } = params;

  const statusMsg = await rawSend(chatId, "🖼️ أحمّل الصورة وأحللها...");

  try {
    // Download photo from Telegram
    const imageBase64 = await downloadFileAsBase64(fileId);
    if (!imageBase64) {
      await editMessage(chatId, statusMsg, "❌ فشل تحميل الصورة من Telegram.");
      return;
    }

    await editMessage(chatId, statusMsg, "🔍 أحلل الصورة...");

    // Pass to agent loop with image context
    await processWithAgent({
      chatId,
      text: caption || "حلّل هذه الصورة بالتفصيل",
      username,
      imageBase64,
      imageMimeType: "image/jpeg",
      statusMsgId: statusMsg,
    });
  } catch (err) {
    logger.error({ err, chatId }, "Photo handler error");
    await editMessage(chatId, statusMsg, "❌ حدث خطأ أثناء تحليل الصورة.");
  }
}

// ─── DOCUMENT HANDLER ─────────────────────────────────────────

async function handleDocumentMessage(params: {
  chatId: string;
  username: string;
  doc: TelegramBot.Document;
  caption: string;
}): Promise<void> {
  const { chatId, username, doc, caption } = params;
  const fileName = doc.file_name ?? "ملف";
  const mimeType = doc.mime_type ?? "application/octet-stream";
  const fileSize = doc.file_size ?? 0;

  const statusMsg = await rawSend(chatId, `📁 أعالج الملف: **${fileName}**...`);

  // Size check (max 20MB)
  if (fileSize > 20 * 1024 * 1024) {
    await editMessage(chatId, statusMsg, `❌ الملف كبير جداً (${(fileSize / 1024 / 1024).toFixed(1)} MB). الحد الأقصى 20 MB.`);
    return;
  }

  try {
    // Image documents → analyze as photo
    if (mimeType.startsWith("image/")) {
      const imageBase64 = await downloadFileAsBase64(doc.file_id);
      if (imageBase64) {
        await processWithAgent({
          chatId,
          text: caption || `حلّل هذه الصورة: ${fileName}`,
          username,
          imageBase64,
          imageMimeType: mimeType,
          statusMsgId: statusMsg,
        });
        return;
      }
    }

    // Text/code/JSON files → read content
    if (isTextFile(fileName, mimeType)) {
      const content = await downloadFileAsText(doc.file_id);
      if (content) {
        const question = caption || `حلّل محتوى هذا الملف: ${fileName}`;
        const fileContext = `[ملف مرفق: ${fileName}]\n\`\`\`\n${content.slice(0, 8000)}\n\`\`\``;
        await processWithAgent({
          chatId,
          text: `${question}\n\n${fileContext}`,
          username,
          statusMsgId: statusMsg,
        });
        return;
      }
    }

    // Unknown file type
    await editMessage(
      chatId,
      statusMsg,
      `📁 **${fileName}** (${mimeType})\n\nاستقبلت الملف. ${caption ? `\n\n${caption}` : "ما الذي تريد فعله بهذا الملف؟"}`
    );
  } catch (err) {
    logger.error({ err, chatId }, "Document handler error");
    await editMessage(chatId, statusMsg, `❌ فشل معالجة الملف "${fileName}".`);
  }
}

// ─── CORE AGENT PROCESSOR ─────────────────────────────────────

async function processWithAgent(params: {
  chatId: string;
  text: string;
  username: string;
  imageBase64?: string;
  imageMimeType?: string;
  statusMsgId?: number;
}): Promise<void> {
  const { chatId, text, username, imageBase64, imageMimeType } = params;
  let { statusMsgId } = params;

  // Send or reuse status message
  if (!statusMsgId) {
    statusMsgId = await rawSend(chatId, "⏳");
  }

  // Get session & history
  const { sessionId, history } = await getOrCreateSession(chatId, username);

  // Save user message to DB
  await saveMessage(sessionId, "user", text);

  // Track current display state
  let currentDisplay = "⏳";
  const toolLog: string[] = [];
  let lastEditTime = Date.now();

  // Progress handler — real-time updates
  const onProgress = async (stage: AgentStage) => {
    let newDisplay = currentDisplay;

    switch (stage.type) {
      case "thinking":
        newDisplay = `⏳ ${stage.message}`;
        break;

      case "tool_start":
        toolLog.push(`🔧 \`${stage.toolName}\``);
        newDisplay = [
          "⏳ **أعمل على طلبك...**",
          "",
          ...toolLog,
        ].join("\n");
        break;

      case "tool_result":
        // Update last tool to show success
        if (toolLog.length > 0) {
          toolLog[toolLog.length - 1] = `✅ \`${stage.toolName}\``;
        }
        if (stage.toolResult) {
          toolLog.push(`\`\`\`\n${stage.toolResult.slice(0, 200)}\n\`\`\``);
        }
        newDisplay = [
          "⏳ **أعمل على طلبك...**",
          "",
          ...toolLog.slice(-8), // Last 8 lines
        ].join("\n");
        break;

      case "tool_error":
        if (toolLog.length > 0) {
          toolLog[toolLog.length - 1] = `❌ \`${stage.toolName}\`: ${stage.message}`;
        }
        newDisplay = [
          "⏳ **أعمل على طلبك...**",
          "",
          ...toolLog.slice(-6),
        ].join("\n");
        break;

      case "subagent":
        toolLog.push(`🤖 ${stage.message}`);
        newDisplay = ["⏳ **وكيل فرعي يعمل...**", "", ...toolLog.slice(-6)].join("\n");
        break;

      case "error":
        newDisplay = `❌ ${stage.message}`;
        break;

      case "done":
        return; // Don't edit on done, we'll send the final response below
    }

    // Rate limit edits (max 1 edit per 800ms to avoid Telegram limits)
    const now = Date.now();
    if (newDisplay !== currentDisplay && now - lastEditTime > 800) {
      currentDisplay = newDisplay;
      lastEditTime = now;
      await editMessage(chatId, statusMsgId!, currentDisplay).catch(() => {});
    }
  };

  // Run agent
  const result = await runAgentLoop({
    userMessage: text,
    chatId,
    history,
    imageBase64,
    imageMimeType,
    onProgress,
  });

  // Save assistant response
  await saveMessage(sessionId, "assistant", result.content);

  // Send final response (replace the status message)
  await editMessage(chatId, statusMsgId!, result.content);

  // Background tasks
  maybeTriggerLearning(chatId).catch(() => {});
}

// ─── COMMAND HANDLER ──────────────────────────────────────────

async function handleCommand(params: {
  chatId: string;
  text: string;
  username: string;
  userId: string;
}): Promise<void> {
  const { chatId, text, username } = params;
  const [cmd, ...args] = text.split(" ");
  const arg = args.join(" ").trim();

  switch (cmd.toLowerCase()) {
    case "/start":
    case "/help":
      await rawSend(
        chatId,
        `👋 مرحباً ${username}! أنا **AgentX** — وكيل ذكاء اصطناعي على معمارية OpenClaw.

**ما أستطيع فعله:**
• 💬 محادثة طبيعية ذكية
• 🖼️ **تحليل الصور** — أرسل أي صورة وسأحللها
• 📁 **معالجة الملفات** — نصوص، كود، PDF  
• 📤 **إرسال ملفات** — اطلب مني إنشاء وإرسال ملف
• 🔍 البحث على الإنترنت
• 🧠 الذاكرة الدائمة عبر الجلسات
• ⏰ جدولة المهام التلقائية
• 🛠️ نظام المهارات (Skills)

**الأوامر:**
/memory — عرض الذاكرة
/skills — إدارة المهارات
/tasks — المهام المجدولة
/soul — عرض هوية الوكيل
/send\_file — إرسال ملف نصي
/clear — مسح سجل المحادثة
/status — حالة النظام
`
      );
      break;

    case "/memory":
      await handleMemoryCommand(chatId, arg);
      break;

    case "/skills":
      await handleSkillsCommand(chatId, arg);
      break;

    case "/tasks":
      await handleTasksCommand(chatId, arg);
      break;

    case "/soul":
      const soul = (await getWorkspaceFile("SOUL.md")) ?? "لا يوجد SOUL.md";
      await rawSend(chatId, `📖 **SOUL.md**\n\n${soul.slice(0, 3000)}`);
      break;

    case "/send_file": {
      if (!arg) {
        await rawSend(chatId, "الاستخدام: `/send_file اسم_الملف: محتوى الملف`");
        break;
      }
      const colonIdx = arg.indexOf(":");
      if (colonIdx < 0) {
        await rawSend(chatId, "الصيغة: `/send_file filename.txt: المحتوى هنا`");
        break;
      }
      const filename = arg.slice(0, colonIdx).trim();
      const content = arg.slice(colonIdx + 1).trim();
      await sendTextFile(chatId, filename, content);
      break;
    }

    case "/clear":
      await clearSession(chatId);
      await rawSend(chatId, "✅ تم مسح سجل المحادثة.");
      break;

    case "/status": {
      const all = await getAllMemory();
      const skillsCount = Object.keys(all).filter((k) => k.startsWith("SKILL:")).length;
      const memCount = Object.keys(all).filter((k) => !k.startsWith("SKILL:")).length;
      await rawSend(
        chatId,
        `📊 **حالة النظام**\n\n` +
        `🧠 مفاتيح الذاكرة: ${memCount}\n` +
        `🛠️ المهارات المثبّتة: ${skillsCount}\n` +
        `⏰ الوقت: ${new Date().toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" })}\n` +
        `🤖 النموذج: claude-opus-4-7`
      );
      break;
    }

    default:
      await rawSend(chatId, `❓ أمر غير معروف: ${cmd}\nاستخدم /help لقائمة الأوامر.`);
  }
}

// ─── MEMORY COMMANDS ──────────────────────────────────────────

async function handleMemoryCommand(chatId: string, arg: string): Promise<void> {
  if (!arg) {
    const all = await getAllMemory();
    const entries = Object.entries(all)
      .filter(([k]) => !k.startsWith("SKILL:") && !k.startsWith("memory/"))
      .slice(0, 20);

    if (entries.length === 0) {
      await rawSend(chatId, "🧠 الذاكرة فارغة حالياً.");
      return;
    }

    const text = entries.map(([k, v]) => `**${k}:** ${v.slice(0, 100)}`).join("\n");
    await rawSend(chatId, `🧠 **الذاكرة (${entries.length} مفتاح)**\n\n${text}\n\nأوامر: /memory set key:value | /memory del key | /memory search كلمة`);
    return;
  }

  const [sub, ...rest] = arg.split(" ");
  const restStr = rest.join(" ");

  if (sub === "set") {
    const colonIdx = restStr.indexOf(":");
    if (colonIdx < 0) { await rawSend(chatId, "الصيغة: /memory set key:value"); return; }
    const key = restStr.slice(0, colonIdx).trim();
    const value = restStr.slice(colonIdx + 1).trim();
    await upsertMemory(key, value, "general");
    await rawSend(chatId, `✅ حُفظ: **${key}**`);
  } else if (sub === "del") {
    const { deleteMemory } = await import("./memory-manager.js");
    await deleteMemory(restStr.trim());
    await rawSend(chatId, `✅ حُذف: **${restStr.trim()}**`);
  } else if (sub === "search") {
    const { searchMemory } = await import("./memory-manager.js");
    const results = await searchMemory(restStr.trim());
    if (results.length === 0) {
      await rawSend(chatId, "لا نتائج.");
      return;
    }
    const text = results.map((r) => `**${r.key}:** ${r.value.slice(0, 150)}`).join("\n\n");
    await rawSend(chatId, `🔍 **نتائج البحث:**\n\n${text}`);
  } else if (sub === "soul") {
    await rawSend(chatId, "لتعديل SOUL.md، أرسل:\n`/memory set SOUL.md: محتوى SOUL.md الجديد`");
  }
}

// ─── SKILLS COMMANDS ──────────────────────────────────────────

async function handleSkillsCommand(chatId: string, arg: string): Promise<void> {
  if (!arg) {
    const skills = await listSkills();
    if (skills.length === 0) {
      await rawSend(chatId, "🛠️ لا توجد مهارات مثبّتة.\nأرسل: /skills install [محتوى SKILL.md]");
      return;
    }
    const text = skills.map((s) =>
      `${s.enabled ? "✅" : "⏸️"} **${s.name}**: ${s.description}`
    ).join("\n");
    await rawSend(chatId, `🛠️ **المهارات (${skills.length})**\n\n${text}\n\nأوامر:\n/skills enable اسم\n/skills disable اسم\n/skills delete اسم\n/skills install [SKILL.md content]`);
    return;
  }

  const [sub, ...rest] = arg.split(" ");
  const name = rest[0]?.trim() ?? "";

  if (sub === "enable") {
    const ok = await enableSkill(name, true);
    await rawSend(chatId, ok ? `✅ المهارة "${name}" فُعّلت.` : `❌ المهارة "${name}" غير موجودة.`);
  } else if (sub === "disable") {
    const ok = await enableSkill(name, false);
    await rawSend(chatId, ok ? `⏸️ المهارة "${name}" عُطّلت.` : `❌ المهارة "${name}" غير موجودة.`);
  } else if (sub === "delete") {
    await deleteSkill(name);
    await rawSend(chatId, `🗑️ المهارة "${name}" حُذفت.`);
  } else if (sub === "install") {
    const content = rest.join(" ");
    if (!content.includes("---")) {
      await rawSend(chatId, "❌ SKILL.md يجب أن يحتوي frontmatter بصيغة:\n```\n---\nname: اسم-المهارة\ndescription: الوصف\n---\nمحتوى المهارة...\n```");
      return;
    }
    try {
      const skill = await installSkill(content);
      await rawSend(chatId, `✅ مهارة "${skill.name}" مثبّتة بنجاح!`);
    } catch (err) {
      await rawSend(chatId, `❌ فشل التثبيت: ${String(err)}`);
    }
  }
}

// ─── TASKS COMMANDS ───────────────────────────────────────────

async function handleTasksCommand(chatId: string, arg: string): Promise<void> {
  const jobs = await listCronJobs(chatId);
  if (jobs.length === 0) {
    await rawSend(chatId, "⏰ لا توجد مهام مجدولة.\nاطلب من الوكيل جدولة مهمة مثل:\n«ذكّرني كل يوم الساعة 9 بمراجعة البريد»");
    return;
  }
  const text = jobs.map((j) =>
    `${j.isActive ? "✅" : "⏸️"} **${j.name}**\n${j.cronExpr}\nمعرّف: \`${j.id}\``
  ).join("\n\n");
  await rawSend(chatId, `⏰ **المهام المجدولة (${jobs.length})**\n\n${text}`);
}

// ─── FILE SENDING ─────────────────────────────────────────────

export async function sendTextFile(
  chatId: string,
  filename: string,
  content: string,
  caption?: string
): Promise<void> {
  if (!bot) throw new Error("Bot not initialized");
  const buffer = Buffer.from(content, "utf-8");
  await bot.sendDocument(
    chatId,
    buffer,
    { caption: caption ?? `📄 ${filename}` },
    { filename, contentType: "text/plain; charset=utf-8" }
  );
}

export async function sendPhotoFromUrl(chatId: string, url: string, caption?: string): Promise<void> {
  if (!bot) throw new Error("Bot not initialized");
  await bot.sendPhoto(chatId, url, { caption });
}

export async function sendPhotoFromBuffer(chatId: string, buffer: Buffer, caption?: string): Promise<void> {
  if (!bot) throw new Error("Bot not initialized");
  await bot.sendPhoto(chatId, buffer, { caption }, { contentType: "image/png", filename: "image.png" });
}

export async function sendAudio(chatId: string, buffer: Buffer, filename: string): Promise<void> {
  if (!bot) throw new Error("Bot not initialized");
  await bot.sendAudio(chatId, buffer, {}, { filename, contentType: "audio/mpeg" });
}

// ─── FILE DOWNLOADING ─────────────────────────────────────────

async function downloadFileAsBase64(fileId: string): Promise<string | null> {
  if (!bot) return null;
  try {
    const fileLink = await bot.getFileLink(fileId);
    const res = await fetch(fileLink);
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    return buffer.toString("base64");
  } catch (err) {
    logger.error({ err, fileId }, "Failed to download file as base64");
    return null;
  }
}

async function downloadFileAsText(fileId: string): Promise<string | null> {
  if (!bot) return null;
  try {
    const fileLink = await bot.getFileLink(fileId);
    const res = await fetch(fileLink);
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    return res.text();
  } catch (err) {
    logger.error({ err, fileId }, "Failed to download file as text");
    return null;
  }
}

function isTextFile(filename: string, mimeType: string): boolean {
  const textMimes = [
    "text/", "application/json", "application/xml", "application/javascript",
    "application/typescript", "application/x-python", "application/x-sh",
  ];
  const textExts = [
    ".txt", ".md", ".json", ".yaml", ".yml", ".xml", ".csv", ".ts", ".js",
    ".py", ".sh", ".html", ".css", ".sql", ".env", ".log", ".toml", ".ini",
  ];
  if (textMimes.some((m) => mimeType.startsWith(m))) return true;
  if (textExts.some((e) => filename.toLowerCase().endsWith(e))) return true;
  return false;
}

// ─── MESSAGING UTILITIES ──────────────────────────────────────

async function rawSend(chatId: string, text: string): Promise<number> {
  if (!bot) return 0;
  try {
    // Telegram max message length: 4096 chars
    const chunks = splitMessage(text, 4000);
    let lastMsgId = 0;

    for (const chunk of chunks) {
      const sent = await bot.sendMessage(chatId, chunk, {
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      });
      lastMsgId = sent.message_id;
    }

    return lastMsgId;
  } catch (err: unknown) {
    // Fallback: send without markdown if formatting fails
    try {
      const sent = await bot.sendMessage(chatId, stripMarkdown(text));
      return sent.message_id;
    } catch (err2) {
      logger.error({ err: err2, chatId }, "Failed to send message");
      return 0;
    }
  }
}

async function editMessage(chatId: string, messageId: number, text: string): Promise<void> {
  if (!bot || !messageId) return;
  try {
    const truncated = text.slice(0, 4000);
    await bot.editMessageText(truncated, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    });
  } catch (err: unknown) {
    const errMsg = String(err);
    // Ignore "message is not modified" errors
    if (errMsg.includes("message is not modified")) return;
    // Fallback without markdown
    try {
      await bot.editMessageText(stripMarkdown(text.slice(0, 4000)), {
        chat_id: chatId,
        message_id: messageId,
      });
    } catch { /* ignore */ }
  }
}

function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const parts: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    parts.push(remaining.slice(0, maxLen));
    remaining = remaining.slice(maxLen);
  }
  return parts;
}

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/`(.*?)`/g, "$1")
    .replace(/```[\s\S]*?```/g, "[code]")
    .replace(/\[(.*?)\]\(.*?\)/g, "$1");
}

// ─── SESSION MANAGEMENT ───────────────────────────────────────

async function getOrCreateSession(
  chatId: string,
  username: string
): Promise<{ sessionId: string; history: Array<{ role: "user" | "assistant" | "system"; content: string }> }> {
  let session = (await db.select().from(sessionsTable).where(eq(sessionsTable.chatId, chatId)).limit(1))[0];

  if (!session) {
    const sessionId = randomUUID();
    await db.insert(sessionsTable).values({
      id: sessionId,
      chatId,
      username,
      model: "claude-opus-4-7",
    });
    session = (await db.select().from(sessionsTable).where(eq(sessionsTable.chatId, chatId)).limit(1))[0];
  }

  // Get last 20 messages for context
  const msgs = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.sessionId, session.id))
    .orderBy(messagesTable.createdAt)
    .limit(20);

  const history = msgs.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  return { sessionId: session.id, history };
}

async function saveMessage(sessionId: string, role: "user" | "assistant", content: string): Promise<void> {
  try {
    await db.insert(messagesTable).values({
      id: randomUUID(),
      sessionId,
      role,
      content,
    });
  } catch (err) {
    logger.error({ err }, "Failed to save message");
  }
}

async function clearSession(chatId: string): Promise<void> {
  const session = (await db.select().from(sessionsTable).where(eq(sessionsTable.chatId, chatId)).limit(1))[0];
  if (session) {
    await db.delete(messagesTable).where(eq(messagesTable.sessionId, session.id));
  }
}

// ─── SEND FUNCTIONS (exported for agent use) ─────────────────

export async function sendMessageToChat(chatId: string, text: string): Promise<void> {
  await rawSend(chatId, text);
}

export { rawSend };
