import { pgTable, text, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const sessionsTable = pgTable("sessions", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  model: text("model").notNull().default("claude-opus-4-7"),
  channel: text("channel").notNull().default("web"),
  systemPrompt: text("system_prompt"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertSessionSchema = createInsertSchema(sessionsTable).omit({ createdAt: true, updatedAt: true });
export type InsertSession = z.infer<typeof insertSessionSchema>;
export type Session = typeof sessionsTable.$inferSelect;

export const messagesTable = pgTable("messages", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().references(() => sessionsTable.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  toolName: text("tool_name"),
  toolResult: text("tool_result"),
  tokens: integer("tokens"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertMessageSchema = createInsertSchema(messagesTable).omit({ createdAt: true });
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type Message = typeof messagesTable.$inferSelect;

export const memoryTable = pgTable("memory", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
  category: text("category").notNull().default("general"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertMemorySchema = createInsertSchema(memoryTable).omit({ createdAt: true, updatedAt: true });
export type InsertMemory = z.infer<typeof insertMemorySchema>;
export type MemoryEntry = typeof memoryTable.$inferSelect;

export const skillsTable = pgTable("skills", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  content: text("content").notNull(),
  usageCount: integer("usage_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertSkillSchema = createInsertSchema(skillsTable).omit({ createdAt: true, updatedAt: true, usageCount: true });
export type InsertSkill = z.infer<typeof insertSkillSchema>;
export type Skill = typeof skillsTable.$inferSelect;

export const telegramLogsTable = pgTable("telegram_logs", {
  id: text("id").primaryKey(),
  chatId: text("chat_id").notNull(),
  userId: text("user_id"),
  username: text("username"),
  messageText: text("message_text").notNull(),
  response: text("response"),
  sessionId: text("session_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type TelegramLog = typeof telegramLogsTable.$inferSelect;

// Cron jobs table for autonomous scheduled tasks
export const cronJobsTable = pgTable("cron_jobs", {
  id: text("id").primaryKey(),
  chatId: text("chat_id").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  cronExpr: text("cron_expr").notNull(), // e.g. "*/5 * * * *" or "delay:3600"
  task: text("task").notNull(), // What to do / send
  isActive: boolean("is_active").notNull().default(true),
  runCount: integer("run_count").notNull().default(0),
  lastRunAt: timestamp("last_run_at"),
  nextRunAt: timestamp("next_run_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type CronJob = typeof cronJobsTable.$inferSelect;

// Agent learning log
export const learningLogTable = pgTable("learning_log", {
  id: text("id").primaryKey(),
  type: text("type").notNull(), // insight | skill | correction | milestone
  content: text("content").notNull(),
  source: text("source"), // session_id or "self"
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type LearningLog = typeof learningLogTable.$inferSelect;
