import { logger } from "./logger.js";

const AI_API_URL = "https://claude-gemma-deploy--mraboodaihakerd.replit.app/api/v1/chat/completions";
const AI_API_KEY = "sk-cgw-f2025c25ef08128769853913f62104e1d5cb27a8fc92b2362c7c22a670ddbfc9";
const DEFAULT_MODEL = "claude-opus-4-7";

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface StreamChunk {
  type: "delta" | "done" | "error";
  content?: string;
  error?: string;
}

export async function streamChat(
  messages: ChatMessage[],
  model: string = DEFAULT_MODEL,
  onChunk: (chunk: StreamChunk) => void
): Promise<string> {
  let fullContent = "";

  try {
    const response = await fetch(AI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${AI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`AI API error ${response.status}: ${errText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;
        const data = trimmed.slice(6);
        if (data === "[DONE]") {
          onChunk({ type: "done" });
          continue;
        }
        try {
          const parsed = JSON.parse(data);
          const delta = parsed?.choices?.[0]?.delta?.content;
          if (delta) {
            fullContent += delta;
            onChunk({ type: "delta", content: delta });
          }
        } catch {
          // ignore parse errors for non-JSON lines
        }
      }
    }
  } catch (err) {
    logger.error({ err }, "AI stream error");
    onChunk({ type: "error", error: String(err) });
  }

  return fullContent;
}

export async function chatOnce(
  messages: ChatMessage[],
  model: string = DEFAULT_MODEL
): Promise<string> {
  let result = "";
  await streamChat(messages, model, (chunk) => {
    if (chunk.type === "delta" && chunk.content) {
      result += chunk.content;
    }
  });
  return result;
}
