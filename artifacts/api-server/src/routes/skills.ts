import { Router } from "express";
import { db } from "@workspace/db";
import { skillsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

const router = Router();

// GET /api/skills
router.get("/skills", async (_req, res) => {
  const rows = await db.select().from(skillsTable).orderBy(skillsTable.usageCount);
  res.json(rows.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  })));
});

// POST /api/skills
router.post("/skills", async (req, res) => {
  const { name, description, content } = req.body as {
    name: string;
    description: string;
    content: string;
  };

  if (!name || !description || !content) {
    res.status(400).json({ error: "name, description, and content are required" });
    return;
  }

  const [row] = await db
    .insert(skillsTable)
    .values({ id: randomUUID(), name, description, content })
    .returning();

  res.status(201).json({
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
});

// DELETE /api/skills/:id
router.delete("/skills/:id", async (req, res) => {
  const { id } = req.params;
  await db.delete(skillsTable).where(eq(skillsTable.id, id));
  res.status(204).send();
});

export default router;
