import { Router } from "express";
import { db } from "@workspace/db";
import { sessionsTable, messagesTable } from "@workspace/db";
import { eq, desc, count } from "drizzle-orm";
import { randomUUID } from "crypto";
import { streamChat } from "../lib/ai.js";
import type { ChatMessage } from "../lib/ai.js";

const router = Router();

// GET /api/sessions
router.get("/sessions", async (req, res) => {
  const rows = await db.select().from(sessionsTable).orderBy(desc(sessionsTable.updatedAt));

  const withCounts = await Promise.all(
    rows.map(async (s) => {
      const [msgCount] = await db
        .select({ count: count() })
        .from(messagesTable)
        .where(eq(messagesTable.sessionId, s.id));

      const lastMsgs = await db
        .select()
        .from(messagesTable)
        .where(eq(messagesTable.sessionId, s.id))
        .orderBy(desc(messagesTable.createdAt))
        .limit(1);

      return {
        ...s,
        messageCount: Number(msgCount?.count ?? 0),
        lastMessage: lastMsgs[0]?.content?.slice(0, 80) ?? null,
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
      };
    })
  );

  res.json(withCounts);
});

// POST /api/sessions
router.post("/sessions", async (req, res) => {
  const { title, model, systemPrompt } = req.body as {
    title?: string;
    model?: string;
    systemPrompt?: string;
  };

  const id = randomUUID();
  const [row] = await db
    .insert(sessionsTable)
    .values({
      id,
      title: title ?? "New Chat",
      model: model ?? "claude-opus-4-7",
      channel: "web",
      systemPrompt: systemPrompt ?? null,
    })
    .returning();

  res.status(201).json({
    ...row,
    messageCount: 0,
    lastMessage: null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
});

// GET /api/sessions/:id
router.get("/sessions/:id", async (req, res) => {
  const { id } = req.params;
  const [row] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, id)).limit(1);
  if (!row) return res.status(404).json({ error: "Session not found" });

  const [msgCount] = await db
    .select({ count: count() })
    .from(messagesTable)
    .where(eq(messagesTable.sessionId, id));

  res.json({
    ...row,
    messageCount: Number(msgCount?.count ?? 0),
    lastMessage: null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
});

// PATCH /api/sessions/:id
router.patch("/sessions/:id", async (req, res) => {
  const { id } = req.params;
  const { title, systemPrompt } = req.body as { title?: string; systemPrompt?: string };

  const [row] = await db
    .update(sessionsTable)
    .set({
      ...(title !== undefined ? { title } : {}),
      ...(systemPrompt !== undefined ? { systemPrompt } : {}),
      updatedAt: new Date(),
    })
    .where(eq(sessionsTable.id, id))
    .returning();

  if (!row) return res.status(404).json({ error: "Session not found" });

  res.json({
    ...row,
    messageCount: 0,
    lastMessage: null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
});

// DELETE /api/sessions/:id
router.delete("/sessions/:id", async (req, res) => {
  const { id } = req.params;
  await db.delete(sessionsTable).where(eq(sessionsTable.id, id));
  res.status(204).send();
});

// GET /api/sessions/:id/messages
router.get("/sessions/:id/messages", async (req, res) => {
  const { id } = req.params;
  const msgs = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.sessionId, id))
    .orderBy(messagesTable.createdAt);

  res.json(
    msgs.map((m) => ({
      ...m,
      createdAt: m.createdAt.toISOString(),
    }))
  );
});

// POST /api/sessions/:id/chat — SSE streaming
router.post("/sessions/:id/chat", async (req, res) => {
  const { id } = req.params;
  const { content, model, stream = true } = req.body as {
    content: string;
    model?: string;
    stream?: boolean;
  };

  if (!content?.trim()) {
    return res.status(400).json({ error: "content is required" });
  }

  const [session] = await db
    .select()
    .from(sessionsTable)
    .where(eq(sessionsTable.id, id))
    .limit(1);

  if (!session) return res.status(404).json({ error: "Session not found" });

  // Save user message
  const userMsgId = randomUUID();
  await db.insert(messagesTable).values({
    id: userMsgId,
    sessionId: id,
    role: "user",
    content,
  });

  // Get history
  const history = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.sessionId, id))
    .orderBy(messagesTable.createdAt)
    .limit(30);

  const systemMsg = session.systemPrompt ?? "You are a helpful AI agent. Be concise and accurate. You were built with OpenClaw multi-channel features and Hermes self-improving memory capabilities.";

  const aiMessages: ChatMessage[] = [
    { role: "system", content: systemMsg },
    ...history.slice(0, -1).map((m) => ({
      role: (m.role === "assistant" ? "assistant" : "user") as "user" | "assistant" | "system",
      content: m.content,
    })),
    { role: "user", content },
  ];

  const chosenModel = model ?? session.model ?? "claude-opus-4-7";

  if (stream) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    let fullContent = "";

    await streamChat(aiMessages, chosenModel, (chunk) => {
      if (chunk.type === "delta" && chunk.content) {
        fullContent += chunk.content;
        res.write(`data: ${JSON.stringify({ type: "delta", content: chunk.content })}\n\n`);
      } else if (chunk.type === "done") {
        res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
      } else if (chunk.type === "error") {
        res.write(`data: ${JSON.stringify({ type: "error", error: chunk.error })}\n\n`);
      }
    });

    // Save assistant message
    if (fullContent) {
      await db.insert(messagesTable).values({
        id: randomUUID(),
        sessionId: id,
        role: "assistant",
        content: fullContent,
      });

      await db
        .update(sessionsTable)
        .set({ updatedAt: new Date() })
        .where(eq(sessionsTable.id, id));
    }

    res.end();
  } else {
    // Non-streaming fallback
    let fullContent = "";
    await streamChat(aiMessages, chosenModel, (chunk) => {
      if (chunk.type === "delta" && chunk.content) fullContent += chunk.content;
    });

    await db.insert(messagesTable).values({
      id: randomUUID(),
      sessionId: id,
      role: "assistant",
      content: fullContent,
    });

    res.json({ content: fullContent });
  }
});

// POST /api/sessions/:id/clear
router.post("/sessions/:id/clear", async (req, res) => {
  const { id } = req.params;
  await db.delete(messagesTable).where(eq(messagesTable.sessionId, id));
  res.json({ success: true, message: "Session cleared" });
});

export default router;
