/**
 * Skills API Routes — OpenClaw Skills System
 * Backed by skills-manager.ts (stored in memory DB as SKILL:name keys)
 */
import { Router } from "express";
import {
  listSkills,
  installSkill,
  enableSkill,
  deleteSkill,
  getSkill,
} from "../lib/skills-manager.js";

const router = Router();

// GET /api/skills
router.get("/skills", async (_req, res) => {
  const skills = await listSkills();
  res.json(skills);
});

// GET /api/skills/:name
router.get("/skills/:name", async (req, res) => {
  const skill = await getSkill(req.params.name);
  if (!skill) { res.status(404).json({ error: "Skill not found" }); return; }
  res.json(skill);
});

// POST /api/skills — install a skill from SKILL.md content
router.post("/skills", async (req, res) => {
  const { content, skillMd } = req.body as { content?: string; skillMd?: string };
  const raw = content ?? skillMd ?? "";
  if (!raw) { res.status(400).json({ error: "content (SKILL.md) is required" }); return; }
  try {
    const skill = await installSkill(raw);
    res.status(201).json(skill);
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

// PATCH /api/skills/:name — enable/disable
router.patch("/skills/:name", async (req, res) => {
  const { enabled } = req.body as { enabled?: boolean };
  if (enabled === undefined) { res.status(400).json({ error: "enabled field required" }); return; }
  const ok = await enableSkill(req.params.name, enabled);
  if (!ok) { res.status(404).json({ error: "Skill not found" }); return; }
  res.json({ success: true, name: req.params.name, enabled });
});

// DELETE /api/skills/:name
router.delete("/skills/:name", async (req, res) => {
  await deleteSkill(req.params.name);
  res.status(204).send();
});

export default router;
