import { Router } from "express";
import { runTool, AVAILABLE_TOOLS } from "../lib/tools.js";
import { db } from "@workspace/db";
import { sessionsTable, messagesTable } from "@workspace/db";
import { count, eq } from "drizzle-orm";
import { isBotRunning, getBotStartTime } from "../lib/telegram.js";

const router = Router();

// POST /api/tools/run
router.post("/tools/run", async (req, res) => {
  const { tool, params } = req.body as { tool: string; params: Record<string, unknown> };

  if (!tool) {
    return res.status(400).json({ success: false, result: "", error: "tool is required" });
  }

  const result = await runTool(tool, params ?? {});
  res.json(result);
});

// GET /api/tools
router.get("/tools", (_req, res) => {
  res.json(AVAILABLE_TOOLS.map((name) => ({ name })));
});

// GET /api/agent/stats
router.get("/agent/stats", async (_req, res) => {
  const [sessCount] = await db.select({ count: count() }).from(sessionsTable);
  const [msgCount] = await db.select({ count: count() }).from(messagesTable);

  res.json({
    totalSessions: Number(sessCount?.count ?? 0),
    totalMessages: Number(msgCount?.count ?? 0),
    totalMemoryEntries: 0,
    totalSkills: 0,
    telegramConnected: isBotRunning(),
    uptime: Math.floor((Date.now() - getBotStartTime()) / 1000),
  });
});

export default router;
