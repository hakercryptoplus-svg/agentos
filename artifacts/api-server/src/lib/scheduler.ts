import { db } from "@workspace/db";
import { cronJobsTable, learningLogTable } from "@workspace/db";
import { eq, and, lte } from "drizzle-orm";
import { randomUUID } from "crypto";
import { logger } from "./logger.js";

let schedulerInterval: NodeJS.Timeout | null = null;
let telegramSendFn: ((chatId: string, text: string) => Promise<void>) | null = null;

export function initScheduler(sendFn: (chatId: string, text: string) => Promise<void>): void {
  telegramSendFn = sendFn;

  // Run scheduler every 30 seconds
  schedulerInterval = setInterval(() => {
    runDueJobs().catch((err) => logger.error({ err }, "Scheduler error"));
  }, 30_000);

  logger.info("Scheduler started (30s interval)");
}

async function runDueJobs(): Promise<void> {
  const now = new Date();

  const dueJobs = await db
    .select()
    .from(cronJobsTable)
    .where(and(eq(cronJobsTable.isActive, true), lte(cronJobsTable.nextRunAt, now)));

  for (const job of dueJobs) {
    logger.info({ jobId: job.id, name: job.name }, "Running cron job");
    try {
      if (telegramSendFn) {
        const message = await buildJobMessage(job.task);
        await telegramSendFn(job.chatId, message);
      }

      // Calculate next run time
      const nextRun = calcNextRun(job.cronExpr);

      await db
        .update(cronJobsTable)
        .set({
          runCount: job.runCount + 1,
          lastRunAt: now,
          nextRunAt: nextRun,
          // Deactivate one-shot jobs
          isActive: nextRun !== null,
        })
        .where(eq(cronJobsTable.id, job.id));

      // Log to learning
      await db.insert(learningLogTable).values({
        id: randomUUID(),
        type: "milestone",
        content: `تم تنفيذ المهمة المجدولة "${job.name}" للمستخدم ${job.chatId}`,
        source: "scheduler",
      });
    } catch (err) {
      logger.error({ err, jobId: job.id }, "Failed to run cron job");
    }
  }
}

async function buildJobMessage(task: string): Promise<string> {
  return `⏰ *تذكير مجدول*\n\n${task}`;
}

// Parse human-readable schedule expressions + standard cron
// Supports:
//   "delay:3600"        → run once after 3600 seconds
//   "every:300"         → run every 300 seconds
//   "daily:08:00"       → run daily at 08:00
//   standard cron: "*/5 * * * *"
export function calcNextRun(expr: string): Date | null {
  const now = new Date();

  if (expr.startsWith("delay:")) {
    const secs = parseInt(expr.replace("delay:", ""), 10);
    if (isNaN(secs)) return null;
    return new Date(now.getTime() + secs * 1000);
  }

  if (expr.startsWith("every:")) {
    const secs = parseInt(expr.replace("every:", ""), 10);
    if (isNaN(secs)) return null;
    return new Date(now.getTime() + secs * 1000);
  }

  if (expr.startsWith("daily:")) {
    const [hh, mm] = expr.replace("daily:", "").split(":").map(Number);
    const next = new Date(now);
    next.setHours(hh, mm, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    return next;
  }

  // Simple cron-like: handle */N * * * * (every N minutes)
  const minuteMatch = expr.match(/^\*\/(\d+)\s+\*\s+\*\s+\*\s+\*$/);
  if (minuteMatch) {
    const mins = parseInt(minuteMatch[1], 10);
    return new Date(now.getTime() + mins * 60 * 1000);
  }

  return null;
}

export async function createCronJob(params: {
  chatId: string;
  name: string;
  description: string;
  cronExpr: string;
  task: string;
}): Promise<string> {
  const id = randomUUID();
  const nextRunAt = calcNextRun(params.cronExpr);

  await db.insert(cronJobsTable).values({
    id,
    chatId: params.chatId,
    name: params.name,
    description: params.description,
    cronExpr: params.cronExpr,
    task: params.task,
    isActive: true,
    nextRunAt: nextRunAt ?? new Date(Date.now() + 60_000),
  });

  logger.info({ id, name: params.name, cronExpr: params.cronExpr }, "Cron job created");
  return id;
}

export async function listCronJobs(chatId: string) {
  return db.select().from(cronJobsTable).where(eq(cronJobsTable.chatId, chatId));
}

export async function deleteCronJob(id: string, chatId: string): Promise<boolean> {
  const result = await db
    .delete(cronJobsTable)
    .where(and(eq(cronJobsTable.id, id), eq(cronJobsTable.chatId, chatId)));
  return true;
}

export async function pauseCronJob(id: string): Promise<void> {
  await db.update(cronJobsTable).set({ isActive: false }).where(eq(cronJobsTable.id, id));
}
