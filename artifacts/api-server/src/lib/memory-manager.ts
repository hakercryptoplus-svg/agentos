import { db } from "@workspace/db";
import { memoryTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { logger } from "./logger.js";

// Upsert a memory entry by key
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

// Build the full agent system prompt including memory files
export async function buildSystemPrompt(chatId: string): Promise<string> {
  const memory = await getAllMemory();

  const userProfile = memory[`USER:${chatId}`] ?? memory["USER.md"] ?? "";
  const soul = memory["SOUL.md"] ?? getDefaultSoul();
  const agentMemory = memory["MEMORY.md"] ?? "";
  const personality = memory["PERSONALITY.md"] ?? getDefaultPersonality();
  const notes = Object.entries(memory)
    .filter(([k]) => k.startsWith(`NOTE:${chatId}`))
    .map(([k, v]) => `- ${k.replace(`NOTE:${chatId}:`, "")}: ${v}`)
    .join("\n");

  const parts: string[] = [soul, personality];

  if (userProfile) parts.push(`\n## معلومات المستخدم (USER.md)\n${userProfile}`);
  if (agentMemory) parts.push(`\n## الذاكرة المستمرة (MEMORY.md)\n${agentMemory}`);
  if (notes) parts.push(`\n## ملاحظات خاصة بهذا المستخدم\n${notes}`);

  parts.push(`
## التوقيت الحالي
${new Date().toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" })}

## قواعد صارمة
- أجب دائماً بنفس لغة المستخدم
- احفظ المعلومات المهمة في ذاكرتك
- لا تكذب أبداً على قدراتك
- إذا طُلب منك مهمة مجدولة، أكد أنك سجلتها
- كن مختصراً في تيليجرام — لا تطيل بدون داعٍ
`);

  return parts.join("\n\n");
}

function getDefaultSoul(): string {
  return `# SOUL.md — هوية الوكيل

أنت AgentX — وكيل ذكاء اصطناعي متقدم مبني على:
- OpenClaw: التواصل متعدد القنوات، الأوامر، الجدولة
- Hermes: الذاكرة الذاتية، حلقة التعلم، المهارات القابلة للكتابة الذاتية

شخصيتك:
- صريح وصادق — لا تكذب على قدراتك أبداً
- ذكي وعملي — تعطي حلول حقيقية
- تتعلم من كل محادثة وتطور نفسك
- تبادر — تقترح أفكار حتى لو ما طُلب منك

ما تستطيع فعله حقاً:
- تنفيذ JavaScript في البيئة
- البحث على الإنترنت
- جدولة مهام دورية (cron)
- تذكر كل شيء عبر الجلسات
- تعديل رسائلك أثناء الكتابة
- تعلم من أخطائك وتكتب مهارات جديدة
`;
}

function getDefaultPersonality(): string {
  return `# PERSONALITY.md — أسلوب التواصل

- اللهجة: فصحة بسيطة مع عامية مفهومة للجميع
- المناداة: استخدم اسم المستخدم دائماً
- الحجم: اجعل الردود مناسبة للسؤال — مختصر للأسئلة البسيطة، مفصّل للاستراتيجيات
- الإيموجي: باعتدال وفقط عندما يضيف للموقف
- لا تقل "كمساعد ذكاء اصطناعي"
- إذا كنت لا تعرف، قل ذلك بصراحة
`;
}

// Extract and save insights from a conversation
export async function extractAndSaveInsights(chatId: string, messages: Array<{ role: string; content: string }>): Promise<void> {
  try {
    // Only process if there are enough messages
    if (messages.length < 4) return;

    const userMessages = messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");

    // Extract key info patterns
    const nameMatch = userMessages.match(/(?:اسمي|أنا|اسمك|ناديني)\s+([^\s،.!؟]{2,20})/);
    if (nameMatch) {
      await upsertMemory(`NOTE:${chatId}:user_name`, nameMatch[1], "preference");
      logger.info({ chatId, name: nameMatch[1] }, "Extracted user name");
    }

    // Save last conversation summary key
    const totalChars = messages.reduce((s, m) => s + m.content.length, 0);
    if (totalChars > 500) {
      const summary = `آخر محادثة كانت بتاريخ ${new Date().toLocaleDateString("ar")} وتضمنت ${messages.length} رسالة`;
      await upsertMemory(`NOTE:${chatId}:last_session`, summary, "fact");
    }
  } catch (err) {
    logger.error({ err }, "Error extracting insights");
  }
}
