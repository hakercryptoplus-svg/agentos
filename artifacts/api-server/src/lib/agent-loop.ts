/**
 * Agent Loop — OpenClaw + Hermes style
 *
 * Flow:
 *  1. Build context (system prompt + memory + tools)
 *  2. Call AI → parse tool calls from response
 *  3. Execute tools, update display in real-time
 *  4. Feed results back → repeat until no more tools (max 5 iterations)
 *  5. Return final response
 */

import { chatOnce } from "./ai.js";
import { runTool } from "./tools.js";
import { buildSystemPrompt } from "./memory-manager.js";
import { logger } from "./logger.js";

export type ProgressFn = (stage: AgentStage) => Promise<void>;

export interface AgentStage {
  type: "thinking" | "tool_start" | "tool_result" | "tool_error" | "subagent" | "done" | "error";
  message: string;
  toolName?: string;
  toolParams?: string;
  toolResult?: string;
  iteration?: number;
}

export interface AgentResult {
  content: string;
  toolsUsed: string[];
  iterations: number;
}

// Tool definitions injected into system prompt
const TOOL_DEFINITIONS = `
You have access to the following tools. Use them when needed by writing EXACTLY this format:

<tool_call>
<name>TOOL_NAME</name>
<params>{"key": "value"}</params>
</tool_call>

IMPORTANT: You can call multiple tools. After calling a tool, wait for the result before calling another.

Available tools:

1. web_search — Search the web for current information
   params: {"query": "search query"}

2. fetch_url — Fetch and read a URL
   params: {"url": "https://example.com"}

3. calculate — Evaluate math expressions
   params: {"expression": "2 + 2 * 10"}

4. get_datetime — Get current date and time
   params: {}

5. system_info — Get real server/environment specs (CPU, RAM, OS)
   params: {}

6. memory_read — Read from persistent memory
   params: {"key": "key_name"} or {} for all

7. memory_write — Write to persistent memory
   params: {"key": "key", "value": "value", "category": "general"}

8. schedule_task — Schedule a recurring or one-time task
   params: {"chatId": "ID", "name": "Task name", "task": "What to do", "cron": "every:3600"}

9. list_tasks — List all scheduled tasks for a chat
   params: {"chatId": "ID"}

Rules:
- Use tools when the user asks for real-time info, calculations, or actions
- Always show your reasoning before calling a tool
- After getting a tool result, explain it clearly to the user
- You can call up to 5 tools per response
`;

const MAX_TOOL_ITERATIONS = 5;
const TOOL_CALL_RE = /<tool_call>\s*<name>([\w_]+)<\/name>\s*<params>([\s\S]*?)<\/params>\s*<\/tool_call>/g;

export async function runAgentLoop(params: {
  userMessage: string;
  chatId: string;
  history: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  model?: string;
  onProgress: ProgressFn;
}): Promise<AgentResult> {
  const { userMessage, chatId, history, model = "claude-opus-4-7", onProgress } = params;

  const toolsUsed: string[] = [];
  let iterations = 0;

  // Build system prompt with memory
  const memoryPrompt = await buildSystemPrompt(chatId);
  const systemPrompt = `${memoryPrompt}\n\n---\n\n## أدوات الوكيل\n${TOOL_DEFINITIONS}`;

  // Build initial messages
  const messages = [
    { role: "system" as const, content: systemPrompt },
    ...history,
    { role: "user" as const, content: userMessage },
  ];

  await onProgress({ type: "thinking", message: "أفكر في طلبك..." });

  let finalContent = "";
  const toolResultsContext: string[] = [];

  // Agent loop
  while (iterations < MAX_TOOL_ITERATIONS) {
    iterations++;

    // Get AI response
    let aiResponse: string;
    try {
      // Add tool results from previous iterations
      const currentMessages = [...messages];
      if (toolResultsContext.length > 0) {
        currentMessages.push({
          role: "assistant",
          content: toolResultsContext.join("\n\n"),
        });
        currentMessages.push({
          role: "user",
          content: "استمر بناءً على نتائج الأدوات أعلاه.",
        });
      }

      aiResponse = await chatOnce(currentMessages, model);
    } catch (err) {
      logger.error({ err }, "AI call failed in agent loop");
      await onProgress({ type: "error", message: `خطأ في الاتصال بالذكاء الاصطناعي: ${String(err)}` });
      return { content: "⚠️ حدث خطأ في الاتصال. حاول مرة أخرى.", toolsUsed, iterations };
    }

    // Parse tool calls
    const toolCalls = extractToolCalls(aiResponse);

    if (toolCalls.length === 0) {
      // No tools — this is the final response
      finalContent = aiResponse;
      break;
    }

    // Execute tools
    const toolResults: string[] = [];

    for (const tc of toolCalls) {
      await onProgress({
        type: "tool_start",
        message: `تنفيذ: ${tc.name}`,
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
            message: `نتيجة ${tc.name}`,
            toolName: tc.name,
            toolResult: result.result.slice(0, 800),
            iteration: iterations,
          });
          toolResults.push(`[نتيجة ${tc.name}]:\n${result.result}`);
          toolResultsContext.push(`الوكيل استخدم ${tc.name} وحصل على:\n${result.result}`);
        } else {
          await onProgress({
            type: "tool_error",
            message: `فشل ${tc.name}: ${result.error}`,
            toolName: tc.name,
            iteration: iterations,
          });
          toolResults.push(`[خطأ في ${tc.name}]: ${result.error}`);
          toolResultsContext.push(`الوكيل حاول ${tc.name} لكن فشل: ${result.error}`);
        }
      } catch (err) {
        logger.error({ err, tool: tc.name }, "Tool execution error");
        await onProgress({
          type: "tool_error",
          message: `خطأ في ${tc.name}: ${String(err)}`,
          toolName: tc.name,
        });
      }
    }

    // Add tool results back to messages for next iteration
    messages.push({ role: "assistant", content: aiResponse });
    messages.push({
      role: "user",
      content: `نتائج الأدوات:\n${toolResults.join("\n\n")}\n\nالآن أجب على سؤال المستخدم بشكل كامل.`,
    });
  }

  // If we hit max iterations without a final response, generate one
  if (!finalContent) {
    await onProgress({ type: "thinking", message: "أجمع النتائج وأصيغ الإجابة..." });
    try {
      finalContent = await chatOnce(messages, model);
    } catch {
      finalContent = "تم تنفيذ العمليات المطلوبة. راجع النتائج أعلاه.";
    }
  }

  await onProgress({ type: "done", message: "اكتمل", toolsUsed: toolsUsed.join(", ") } as AgentStage);

  return { content: finalContent, toolsUsed, iterations };
}

interface ToolCall {
  name: string;
  params: Record<string, unknown>;
}

function extractToolCalls(text: string): ToolCall[] {
  const calls: ToolCall[] = [];
  let match: RegExpExecArray | null;

  // Reset regex
  TOOL_CALL_RE.lastIndex = 0;

  while ((match = TOOL_CALL_RE.exec(text)) !== null) {
    const name = match[1].trim();
    const paramsRaw = match[2].trim();

    let params: Record<string, unknown> = {};
    try {
      params = JSON.parse(paramsRaw);
    } catch {
      // Try to extract key-value pairs manually
      const kv = paramsRaw.match(/"(\w+)":\s*"([^"]+)"/g);
      if (kv) {
        for (const pair of kv) {
          const [k, v] = pair.split(":").map((s) => s.replace(/"/g, "").trim());
          params[k] = v;
        }
      }
    }

    calls.push({ name, params });
  }

  return calls;
}

// SubAgent: spawn a focused agent for a sub-task
export async function runSubAgent(params: {
  task: string;
  chatId: string;
  onProgress: ProgressFn;
}): Promise<string> {
  const { task, chatId, onProgress } = params;

  await onProgress({
    type: "subagent",
    message: `وكيل فرعي يعمل: ${task.slice(0, 50)}`,
  });

  const result = await runAgentLoop({
    userMessage: task,
    chatId,
    history: [],
    onProgress: async (stage) => {
      // Prefix subagent progress
      await onProgress({
        ...stage,
        message: `[وكيل فرعي] ${stage.message}`,
      });
    },
  });

  return result.content;
}
