import { db } from "@workspace/db";
import { messagesTable, skillsTable, learningLogTable, sessionsTable } from "@workspace/db";
import { eq, desc, count } from "drizzle-orm";
import { randomUUID } from "crypto";
import { chatOnce } from "./ai.js";
import { upsertMemory } from "./memory-manager.js";
import { logger } from "./logger.js";

// Trigger learning after every 10 messages in a session
export async function maybeTriggerLearning(sessionId: string): Promise<void> {
  try {
    const [msgCount] = await db
      .select({ count: count() })
      .from(messagesTable)
      .where(eq(messagesTable.sessionId, sessionId));

    const total = Number(msgCount?.count ?? 0);
    // Every 10 messages, run a learning cycle
    if (total > 0 && total % 10 === 0) {
      await runLearningCycle(sessionId);
    }
  } catch (err) {
    logger.error({ err }, "Learning trigger error");
  }
}

export async function runLearningCycle(sessionId: string): Promise<void> {
  logger.info({ sessionId }, "Starting learning cycle");

  try {
    const messages = await db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.sessionId, sessionId))
      .orderBy(desc(messagesTable.createdAt))
      .limit(20);

    if (messages.length < 4) return;

    const convoText = messages
      .reverse()
      .map((m) => `${m.role}: ${m.content.slice(0, 200)}`)
      .join("\n");

    const prompt = `أنت محلل أداء للذكاء الاصطناعي. راجع هذه المحادثة واستخرج:
1. ما الأشياء التي أجاب عليها الوكيل بشكل صحيح؟
2. ما الأخطاء أو نقاط الضعف؟
3. ما المهارة الجديدة التي يجب تعلمها؟
4. ما المعلومة المهمة التي يجب حفظها؟

المحادثة:
${convoText}

أجب بتنسيق JSON:
{
  "strengths": "نقاط القوة",
  "weaknesses": "نقاط الضعف",
  "new_skill": {"name": "اسم المهارة", "description": "وصفها", "content": "محتواها بالماركداون"},
  "memory_update": "معلومة مهمة لحفظها"
}`;

    const response = await chatOnce([{ role: "user", content: prompt }]);

    // Try to parse JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.warn({ sessionId }, "Learning: could not parse JSON from AI");
      return;
    }

    const insight = JSON.parse(jsonMatch[0]) as {
      strengths?: string;
      weaknesses?: string;
      new_skill?: { name: string; description: string; content: string };
      memory_update?: string;
    };

    // Save new skill if suggested
    if (insight.new_skill?.name && insight.new_skill.content) {
      const existing = await db
        .select()
        .from(skillsTable)
        .where(eq(skillsTable.name, insight.new_skill.name))
        .limit(1);

      if (existing.length === 0) {
        await db.insert(skillsTable).values({
          id: randomUUID(),
          name: insight.new_skill.name,
          description: insight.new_skill.description ?? "",
          content: insight.new_skill.content,
          usageCount: 0,
        });
        logger.info({ skill: insight.new_skill.name }, "Learning: new skill created");
      }
    }

    // Save memory update
    if (insight.memory_update) {
      const key = `MEMORY.md`;
      const existing = await db.select().from(messagesTable).limit(1);
      await upsertMemory(key, insight.memory_update, "fact");
    }

    // Log the learning event
    await db.insert(learningLogTable).values({
      id: randomUUID(),
      type: "insight",
      content: JSON.stringify({
        strengths: insight.strengths,
        weaknesses: insight.weaknesses,
        skillCreated: insight.new_skill?.name,
      }),
      source: sessionId,
    });

    logger.info({ sessionId }, "Learning cycle completed");
  } catch (err) {
    logger.error({ err, sessionId }, "Learning cycle failed");
  }
}

export async function getLearningStats(): Promise<{
  totalInsights: number;
  totalSkillsCreated: number;
  lastLearning: string | null;
}> {
  const [insightCount] = await db.select({ count: count() }).from(learningLogTable);
  const [skillCount] = await db.select({ count: count() }).from(skillsTable);
  const lastLog = await db
    .select()
    .from(learningLogTable)
    .orderBy(desc(learningLogTable.createdAt))
    .limit(1);

  return {
    totalInsights: Number(insightCount?.count ?? 0),
    totalSkillsCreated: Number(skillCount?.count ?? 0),
    lastLearning: lastLog[0]?.createdAt.toISOString() ?? null,
  };
}
