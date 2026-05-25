/**
 * OpenClaw Skills Manager
 * 
 * A skill = a directory with SKILL.md (+ optional scripts/ + references/)
 * Skills are stored in the DB and injected into the system prompt.
 * 
 * Format of SKILL.md:
 * ---
 * name: skill-name
 * description: What this skill does
 * user-invocable: true
 * ---
 * 
 * # Instructions
 * Natural language instructions for the agent...
 */

import { db } from "@workspace/db";
import { memoryTable } from "@workspace/db";
import { eq, like } from "drizzle-orm";
import { randomUUID } from "crypto";
import { logger } from "./logger.js";

export interface Skill {
  id: string;
  name: string;
  description: string;
  content: string;       // Full SKILL.md content
  enabled: boolean;
  userInvocable: boolean;
  createdAt: Date;
}

const SKILL_PREFIX = "SKILL:";

// ─── Parse SKILL.md frontmatter ───────────────────────────────

function parseSkillMd(raw: string): { name: string; description: string; userInvocable: boolean; content: string } {
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!fmMatch) {
    return { name: "unknown", description: "", userInvocable: false, content: raw };
  }

  const fm = fmMatch[1];
  const body = fmMatch[2] ?? "";

  const name = fm.match(/^name:\s*(.+)$/m)?.[1]?.trim() ?? "unknown";
  const description = fm.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? "";
  const userInvocable = fm.match(/^user-invocable:\s*(true|false)$/m)?.[1] === "true";

  return { name, description, userInvocable, content: raw };
}

// ─── CRUD Operations ───────────────────────────────────────────

export async function installSkill(skillMd: string): Promise<Skill> {
  const parsed = parseSkillMd(skillMd);
  const id = randomUUID();
  const key = `${SKILL_PREFIX}${parsed.name}`;

  const skillData: Skill = {
    id,
    name: parsed.name,
    description: parsed.description,
    content: parsed.content,
    enabled: true,
    userInvocable: parsed.userInvocable,
    createdAt: new Date(),
  };

  await db.delete(memoryTable).where(eq(memoryTable.key, key));
  await db.insert(memoryTable).values({
    id,
    key,
    value: JSON.stringify(skillData),
    category: "skill",
  });

  logger.info({ name: parsed.name }, "Skill installed");
  return skillData;
}

export async function listSkills(): Promise<Skill[]> {
  const rows = await db.select().from(memoryTable).where(like(memoryTable.key, `${SKILL_PREFIX}%`));
  return rows.map((r) => {
    try { return JSON.parse(r.value) as Skill; }
    catch { return null; }
  }).filter(Boolean) as Skill[];
}

export async function getSkill(name: string): Promise<Skill | null> {
  const rows = await db.select().from(memoryTable)
    .where(eq(memoryTable.key, `${SKILL_PREFIX}${name}`)).limit(1);
  if (!rows[0]) return null;
  try { return JSON.parse(rows[0].value) as Skill; }
  catch { return null; }
}

export async function enableSkill(name: string, enabled: boolean): Promise<boolean> {
  const skill = await getSkill(name);
  if (!skill) return false;
  skill.enabled = enabled;
  await db.update(memoryTable)
    .set({ value: JSON.stringify(skill), updatedAt: new Date() })
    .where(eq(memoryTable.key, `${SKILL_PREFIX}${name}`));
  return true;
}

export async function deleteSkill(name: string): Promise<boolean> {
  const result = await db.delete(memoryTable)
    .where(eq(memoryTable.key, `${SKILL_PREFIX}${name}`));
  return true;
}

// ─── Skill Execution ───────────────────────────────────────────

export async function getSkillPrompt(name: string): Promise<string | null> {
  const skill = await getSkill(name);
  if (!skill || !skill.enabled) return null;
  return skill.content;
}

export async function getAllActiveSkillsContent(): Promise<string> {
  const skills = await listSkills();
  const active = skills.filter((s) => s.enabled);
  if (active.length === 0) return "";
  return active.map((s) => `## مهارة: ${s.name}\n${s.content}`).join("\n\n---\n\n");
}

// ─── Built-in Default Skills ───────────────────────────────────

export const DEFAULT_SKILLS: string[] = [
  `---
name: web-researcher
description: بحث متعمق على الإنترنت وتلخيص النتائج بشكل منظم
user-invocable: true
---

# مهارة: باحث الويب

## متى تُستخدم
عندما يحتاج المستخدم معلومات حديثة، أخبار، أسعار، أو أي بيانات لا تعرفها.

## الخطوات
1. حلل طلب المستخدم لاستخراج الكلمات المفتاحية
2. استخدم web_search مع استعلام محدد
3. إذا النتائج غير كافية، جرب استعلاماً مختلفاً
4. لخّص النتائج في نقاط واضحة مع ذكر المصدر
5. أضف رأيك التحليلي إن كان مناسباً
`,

  `---
name: memory-keeper
description: حفظ واسترجاع المعلومات المهمة من الذاكرة الدائمة
user-invocable: true
---

# مهارة: حافظ الذاكرة

## متى تُستخدم
- عندما يطلب المستخدم "تذكر" شيئاً
- عندما تكتشف معلومة شخصية مهمة
- عندما يسأل "ما الذي تتذكره عني؟"

## الخطوات للحفظ
1. استخدم memory_write لحفظ المعلومة بمفتاح وصفي
2. أكد للمستخدم: "✅ حفظت: [ملخص المعلومة]"
3. تأكد من تحديث MEMORY.md إن كانت المعلومة مهمة جداً

## الخطوات للاسترجاع
1. استخدم memory_read مع المفتاح المناسب
2. إذا لم تجد، جرب memory_search
3. أجب بما وجدت أو وضّح أنك لا تعرف
`,

  `---
name: image-analyst
description: تحليل الصور والوسائط التي يرسلها المستخدم
user-invocable: false
---

# مهارة: محلل الصور

## متى تُفعَّل
تلقائياً عند استقبال صورة أو ملف مرئي من المستخدم.

## الخطوات
1. استخدم أداة image_analyze مع base64 الصورة
2. صف ما تراه: الأشياء، الألوان، النص، الأشخاص، المشهد
3. ربط التحليل بسياق المحادثة وسؤال المستخدم
4. إذا كان هناك نص في الصورة، استخرجه كاملاً

## ملاحظات
- كن دقيقاً ومفصلاً
- إذا الصورة تحتوي نصاً: اقرأه بالكامل
- إذا السؤال غامض: افترض أن المستخدم يريد وصفاً شاملاً
`,
];

export async function initDefaultSkills(): Promise<void> {
  for (const skillMd of DEFAULT_SKILLS) {
    try {
      const parsed = parseSkillMd(skillMd);
      const existing = await getSkill(parsed.name);
      if (!existing) {
        await installSkill(skillMd);
        logger.info({ name: parsed.name }, "Default skill installed");
      }
    } catch (err) {
      logger.error({ err }, "Failed to install default skill");
    }
  }
}
