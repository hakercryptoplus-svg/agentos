/**
 * OpenClaw Agent Loop — Professional Grade
 *
 * Flow (OpenClaw style):
 *  1. Build context: SOUL.md + AGENTS.md + USER.md + MEMORY.md + daily logs + skills
 *  2. Inject MCP tool definitions
 *  3. Call AI → parse <tool_call> blocks
 *  4. Execute tools, stream progress updates in real-time via onProgress
 *  5. Feed results back → repeat (max 8 iterations)
 *  6. Extract insights + append daily log
 *  7. Return final response
 */

import { chatOnce } from "./ai.js";
import { runTool, MCP_TOOLS } from "./tools.js";
import { buildSystemPrompt, extractAndSaveInsights } from "./memory-manager.js";
import { logger } from "./logger.js";

export type ProgressFn = (stage: AgentStage) => Promise<void>;

export interface AgentStage {
  type: "thinking" | "tool_start" | "tool_result" | "tool_error" | "subagent" | "done" | "error";
  message: string;
  toolName?: string;
  toolParams?: string;
  toolResult?: string;
  iteration?: number;
  toolsUsed?: string;
}

export interface AgentResult {
  content: string;
  toolsUsed: string[];
  iterations: number;
}

// ─── MCP Tool Definitions (injected into system prompt) ────────

function buildToolDefinitions(): string {
  const defs = MCP_TOOLS.map((t) => {
    const paramsDesc = Object.entries(t.params_schema)
      .map(([k, v]) => `      ${k}${v.required ? " (مطلوب)" : ""}: ${v.description}`)
      .join("\n");
    return `### ${t.name} [${t.category}]\n${t.description}\n${paramsDesc ? `الباراميترات:\n${paramsDesc}` : "لا باراميترات"}`;
  }).join("\n\n");

  return `## أدوات MCP المتاحة

استخدم الأدوات بكتابة:
\`\`\`
<tool_call>
<name>اسم_الأداة</name>
<params>{"key": "value"}</params>
</tool_call>
\`\`\`

**قواعد مهمة:**
- استخدم الأدوات فقط عند الحاجة لمعلومات حقيقية
- اشرح ماذا ستفعل قبل استدعاء أي أداة
- يمكنك استدعاء عدة أدوات تتالياً
- بعد نتيجة الأداة: وضّح للمستخدم ما حدث
- لا تخترع نتائج — استخدم الأدوات للحقائق

---

${defs}`;
}

const MAX_ITERATIONS = 8;
const TOOL_CALL_RE = /<tool_call>\s*<name>([\w_]+)<\/name>\s*<params>([\s\S]*?)<\/params>\s*<\/tool_call>/g;

// ─── Main Agent Loop ───────────────────────────────────────────

export async function runAgentLoop(params: {
  userMessage: string;
  chatId: string;
  history: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  model?: string;
  imageBase64?: string;
  imageMimeType?: string;
  onProgress: ProgressFn;
}): Promise<AgentResult> {
  const {
    userMessage,
    chatId,
    history,
    model = "claude-opus-4-7",
    imageBase64,
    imageMimeType,
    onProgress,
  } = params;

  const toolsUsed: string[] = [];
  let iterations = 0;

  await onProgress({ type: "thinking", message: "⏳ أقرأ السياق..." });

  // Build full OpenClaw system prompt
  const systemPrompt = await buildSystemPrompt(chatId);
  const toolDefs = buildToolDefinitions();

  // If image attached, trigger image analysis immediately
  let enrichedMessage = userMessage;
  if (imageBase64) {
    await onProgress({ type: "tool_start", message: "🖼️ أحلل الصورة...", toolName: "image_analyze" });
    const imageResult = await runTool("image_analyze", {
      image_base64: imageBase64,
      mime_type: imageMimeType ?? "image/jpeg",
      question: userMessage || "صف ما تراه في هذه الصورة بالتفصيل",
    });
    toolsUsed.push("image_analyze");
    if (imageResult.success) {
      enrichedMessage = `[الصورة المرفقة — التحليل الأولي:]\n${imageResult.result}\n\n[سؤال المستخدم:] ${userMessage || "صف هذه الصورة"}`;
      await onProgress({
        type: "tool_result",
        message: "✅ تحليل الصورة اكتمل",
        toolName: "image_analyze",
        toolResult: imageResult.result.slice(0, 300),
      });
    }
  }

  // Build messages
  const messages: Array<{ role: "user" | "assistant" | "system"; content: string }> = [
    { role: "system", content: `${systemPrompt}\n\n---\n\n${toolDefs}` },
    ...history.slice(-20), // Last 20 messages for context
    { role: "user", content: enrichedMessage },
  ];

  await onProgress({ type: "thinking", message: "💭 أفكر في الرد..." });

  let finalContent = "";

  // ─── Agent Loop ───────────────────────────────────────────

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    // Call AI
    let aiResponse: string;
    try {
      aiResponse = await chatOnce(messages, model);
    } catch (err) {
      logger.error({ err }, "AI call failed");
      await onProgress({ type: "error", message: `خطأ في الاتصال: ${String(err)}` });
      return { content: "⚠️ خطأ في الاتصال بالذكاء الاصطناعي. حاول مرة أخرى.", toolsUsed, iterations };
    }

    // Extract tool calls
    const toolCalls = extractToolCalls(aiResponse);

    if (toolCalls.length === 0) {
      // Final response — no more tool calls
      finalContent = aiResponse;
      break;
    }

    // Add AI response to messages
    messages.push({ role: "assistant", content: aiResponse });

    // Execute tools
    const toolResults: string[] = [];

    for (const tc of toolCalls) {
      await onProgress({
        type: "tool_start",
        message: `🔧 تنفيذ: **${tc.name}**`,
        toolName: tc.name,
        toolParams: JSON.stringify(tc.params, null, 2),
        iteration: iterations,
      });

      toolsUsed.push(tc.name);

      try {
        const result = await runTool(tc.name, tc.params);

        if (result.success) {
          await onProgress({
            type: "tool_result",
            message: `✅ ${tc.name} اكتمل`,
            toolName: tc.name,
            toolResult: result.result.slice(0, 600),
            iteration: iterations,
          });
          toolResults.push(`<tool_result name="${tc.name}">\n${result.result}\n</tool_result>`);
        } else {
          await onProgress({
            type: "tool_error",
            message: `❌ ${tc.name}: ${result.error}`,
            toolName: tc.name,
            iteration: iterations,
          });
          toolResults.push(`<tool_result name="${tc.name}" error="true">\n${result.error}\n</tool_result>`);
        }
      } catch (err) {
        logger.error({ err, tool: tc.name }, "Tool error");
        toolResults.push(`<tool_result name="${tc.name}" error="true">\n${String(err)}\n</tool_result>`);
      }
    }

    // Feed results back
    messages.push({
      role: "user",
      content: `نتائج الأدوات:\n${toolResults.join("\n\n")}\n\nالآن أكمل ردك النهائي للمستخدم.`,
    });
  }

  // Fallback if hit max iterations
  if (!finalContent) {
    await onProgress({ type: "thinking", message: "🔄 أصيغ الإجابة النهائية..." });
    try {
      finalContent = await chatOnce(messages, model);
    } catch {
      finalContent = "✅ تمت العمليات المطلوبة. راجع التفاصيل أعلاه.";
    }
  }

  // Background: extract insights
  extractAndSaveInsights(chatId, [...history, { role: "user", content: userMessage }]).catch(() => {});

  await onProgress({
    type: "done",
    message: "✅ اكتمل",
    toolsUsed: toolsUsed.join(", "),
  });

  return { content: finalContent, toolsUsed, iterations };
}

// ─── Tool Call Parser ─────────────────────────────────────────

interface ToolCall {
  name: string;
  params: Record<string, unknown>;
}

function extractToolCalls(text: string): ToolCall[] {
  const calls: ToolCall[] = [];
  const re = /<tool_call>\s*<name>([\w_]+)<\/name>\s*<params>([\s\S]*?)<\/params>\s*<\/tool_call>/g;
  let match: RegExpExecArray | null;

  while ((match = re.exec(text)) !== null) {
    const name = match[1].trim();
    const paramsRaw = match[2].trim();
    let params: Record<string, unknown> = {};
    try {
      params = JSON.parse(paramsRaw);
    } catch {
      const pairs = paramsRaw.matchAll(/"(\w+)":\s*"([^"]*)"/g);
      for (const [, k, v] of pairs) params[k] = v;
    }
    calls.push({ name, params });
  }

  return calls;
}

// ─── Sub-Agent ────────────────────────────────────────────────

export async function runSubAgent(params: {
  task: string;
  chatId: string;
  onProgress: ProgressFn;
}): Promise<string> {
  const { task, chatId, onProgress } = params;
  await onProgress({ type: "subagent", message: `🤖 وكيل فرعي: ${task.slice(0, 60)}...` });

  const result = await runAgentLoop({
    userMessage: task,
    chatId,
    history: [],
    onProgress: async (stage) => {
      await onProgress({ ...stage, message: `[وكيل فرعي] ${stage.message}` });
    },
  });

  return result.content;
}
