import { pgTable, text, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Sessions table
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

// Messages table
export const messagesTable = pgTable("messages", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().references(() => sessionsTable.id, { onDelete: "cascade" }),
  role: text("role").notNull(), // user | assistant | system | tool
  content: text("content").notNull(),
  toolName: text("tool_name"),
  toolResult: text("tool_result"),
  tokens: integer("tokens"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertMessageSchema = createInsertSchema(messagesTable).omit({ createdAt: true });
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type Message = typeof messagesTable.$inferSelect;

// Memory table (Hermes-style three-layer memory)
export const memoryTable = pgTable("memory", {
  id: text("id").primaryKey(),
  key: text("key").notNull(),
  value: text("value").notNull(),
  category: text("category").notNull().default("general"), // general | preference | skill | fact
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertMemorySchema = createInsertSchema(memoryTable).omit({ createdAt: true, updatedAt: true });
export type InsertMemory = z.infer<typeof insertMemorySchema>;
export type MemoryEntry = typeof memoryTable.$inferSelect;

// Skills table (Hermes self-writing skills)
export const skillsTable = pgTable("skills", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  content: text("content").notNull(), // Markdown skill file
  usageCount: integer("usage_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertSkillSchema = createInsertSchema(skillsTable).omit({ createdAt: true, updatedAt: true, usageCount: true });
export type InsertSkill = z.infer<typeof insertSkillSchema>;
export type Skill = typeof skillsTable.$inferSelect;

// Telegram messages log
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
