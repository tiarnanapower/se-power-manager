// Server-only: talks to the Portkey AI gateway (OpenAI-compatible). The API
// key never leaves the server and is never sent to the model.
import "server-only";
import { logError } from "@/lib/errors/logger";

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolDefinition {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export class CopilotError extends Error {}

const DEFAULT_BASE_URL = "https://api.portkey.ai/v1";
const REQUEST_TIMEOUT_MS = 60_000;

export function isCopilotConfigured(): boolean {
  return Boolean(process.env.PORTKEY_API_KEY);
}

export function getModel(): string {
  return process.env.PORTKEY_MODEL || "@dev-openai/gpt-5-mini";
}

function buildHeaders(): Record<string, string> {
  const apiKey = process.env.PORTKEY_API_KEY;

  if (!apiKey) throw new CopilotError("The AI copilot isn't configured. Add PORTKEY_API_KEY to the server environment.");

  return { "Content-Type": "application/json", "x-portkey-api-key": apiKey };
}

async function post(body: Record<string, unknown>, signal: AbortSignal | undefined): Promise<Response> {
  const baseUrl = (process.env.PORTKEY_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);

  return fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    cache: "no-store",
  });
}

async function readError(response: Response): Promise<string> {
  const text = await response.text();

  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
    const message = typeof parsed.error === "string" ? parsed.error : (parsed.error?.message ?? parsed.message);

    return (message ?? text).slice(0, 300);
  } catch {
    return text.slice(0, 300);
  }
}

// One model turn. Reasoning effort is kept low for snappy replies; if the
// gateway or model rejects that parameter the call is retried without it.
export async function chatCompletion(params: { messages: ChatMessage[]; tools?: ToolDefinition[]; json?: boolean; signal?: AbortSignal }): Promise<ChatMessage> {
  const base = {
    model: getModel(),
    messages: params.messages,
    ...(params.tools?.length ? { tools: params.tools, tool_choice: "auto" } : {}),
    ...(params.json ? { response_format: { type: "json_object" } } : {}),
    max_completion_tokens: 4000,
  };
  const effort = process.env.PORTKEY_REASONING_EFFORT || "low";
  let response: Response;

  try {
    response = await post({ ...base, reasoning_effort: effort }, params.signal);

    if (response.status === 400 && (await response.clone().text()).includes("reasoning_effort")) {
      response = await post(base, params.signal);
    }
  } catch (error) {
    logError("copilot: gateway request", error);

    throw new CopilotError("Couldn't reach the AI gateway. Check your connection and try again.");
  }

  if (!response.ok) {
    const detail = await readError(response);

    logError("copilot: gateway error", `${response.status} ${detail}`);

    throw new CopilotError(
      response.status === 401 || response.status === 403
        ? "The AI gateway rejected the key. Check PORTKEY_API_KEY and the model access."
        : response.status === 429
          ? "The AI gateway is busy right now. Try again in a moment."
          : `The AI gateway returned an error (${response.status}). Try again, or check the server logs.`,
    );
  }

  const json = (await response.json()) as { choices?: Array<{ message?: ChatMessage }> };
  const message = json.choices?.[0]?.message;

  if (!message) throw new CopilotError("The AI gateway returned an empty response.");

  return message;
}
