import { Router } from "express";
import { db } from "@workspace/db";
import { memoryTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

const router = Router();

// GET /api/memory
router.get("/memory", async (_req, res) => {
  const rows = await db.select().from(memoryTable).orderBy(memoryTable.updatedAt);
  res.json(rows.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  })));
});

// POST /api/memory
router.post("/memory", async (req, res) => {
  const { key, value, category } = req.body as { key: string; value: string; category: string };

  if (!key || !value || !category) {
    res.status(400).json({ error: "key, value, and category are required" });
    return;
  }

  // Check if key already exists — update if so
  const [existing] = await db.select().from(memoryTable).where(eq(memoryTable.key, key)).limit(1);

  if (existing) {
    const [updated] = await db
      .update(memoryTable)
      .set({ value, category, updatedAt: new Date() })
      .where(eq(memoryTable.key, key))
      .returning();
    res.status(201).json({
      ...updated,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    });
    return;
  }

  const [row] = await db
    .insert(memoryTable)
    .values({ id: randomUUID(), key, value, category })
    .returning();

  res.status(201).json({
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
});

// DELETE /api/memory/:id
router.delete("/memory/:id", async (req, res) => {
  const { id } = req.params;
  await db.delete(memoryTable).where(eq(memoryTable.id, id));
  res.status(204).send();
});

export default router;
