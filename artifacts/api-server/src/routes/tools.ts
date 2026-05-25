import { Router } from "express";
import { runTool, AVAILABLE_TOOLS } from "../lib/tools.js";
import { db } from "@workspace/db";
import { sessionsTable, messagesTable, memoryTable, skillsTable } from "@workspace/db";
import { count } from "drizzle-orm";
import { isBotRunning, getBotStartTime } from "../lib/telegram.js";

const router = Router();

// POST /api/tools/run
router.post("/tools/run", async (req, res) => {
  const { tool, params } = req.body as { tool: string; params: Record<string, unknown> };
  if (!tool) { res.status(400).json({ success: false, result: "", error: "tool is required" }); return; }
  const result = await runTool(tool, params ?? {});
  res.json(result);
});

// GET /api/tools
router.get("/tools", (_req, res) => {
  res.json(AVAILABLE_TOOLS.map((name) => ({ name })));
});

// GET /api/agent/stats
router.get("/agent/stats", async (_req, res) => {
  const [[sess], [msgs], [mems], [skills]] = await Promise.all([
    db.select({ count: count() }).from(sessionsTable),
    db.select({ count: count() }).from(messagesTable),
    db.select({ count: count() }).from(memoryTable),
    db.select({ count: count() }).from(skillsTable),
  ]);

  res.json({
    totalSessions: Number(sess?.count ?? 0),
    totalMessages: Number(msgs?.count ?? 0),
    totalMemoryEntries: Number(mems?.count ?? 0),
    totalSkills: Number(skills?.count ?? 0),
    telegramConnected: isBotRunning(),
    uptime: Math.floor((Date.now() - getBotStartTime()) / 1000),
  });
});

export default router;
