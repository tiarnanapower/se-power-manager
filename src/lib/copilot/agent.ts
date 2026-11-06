// Server-only: the tool-calling loop. Yields events the route streams to the UI.
import "server-only";
import { type ChatMessage, chatCompletion, CopilotError } from "@/lib/copilot/portkey";
import { buildSystemPrompt } from "@/lib/copilot/prompt";
import { createToolContext, executeTool, TOOL_DEFINITIONS, TOOL_LABELS, type ChoiceSet, type DraftProposal } from "@/lib/copilot/tools";
import { deepClean } from "@/lib/copilot/guard";
import { logError } from "@/lib/errors/logger";

export type CopilotEvent =
  | { type: "step"; label: string }
  | { type: "draft"; proposal: DraftProposal }
  | { type: "choices"; choices: ChoiceSet }
  | { type: "message"; text: string }
  | { type: "error"; message: string };

const MAX_STEPS = 8;
const MAX_RESULT_CHARS = 12_000;
const MAX_TOOL_CALLS_PER_STEP = 5;

function clip(text: string): string {
  return text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}…[truncated]` : text;
}

export async function* runAgent(params: {
  storeHash: string | undefined;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  signal?: AbortSignal;
}): AsyncGenerator<CopilotEvent> {
  const now = new Date();
  const ctx = createToolContext(params.storeHash, now);
  let snapshot: Awaited<ReturnType<typeof ctx.calendar>> | undefined;

  try {
    snapshot = await ctx.calendar();
  } catch (error) {
    logError("copilot: snapshot", error);
  }

  const messages: ChatMessage[] = [{ role: "system", content: buildSystemPrompt(now, snapshot) }, ...params.history.map((m) => ({ role: m.role, content: m.content }) as ChatMessage)];

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const reply = await chatCompletion({ messages, tools: TOOL_DEFINITIONS, signal: params.signal });

      if (!reply.tool_calls?.length) {
        yield { type: "message", text: (reply.content ?? "").trim() || "I couldn't come up with a reply. Try rephrasing." };

        return;
      }

      messages.push({ role: "assistant", content: reply.content ?? null, tool_calls: reply.tool_calls });

      for (const [index, call] of reply.tool_calls.entries()) {
        if (index >= MAX_TOOL_CALLS_PER_STEP) {
          messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ error: "Too many tool calls at once. Ask for fewer things." }) });
          continue;
        }

        yield { type: "step", label: TOOL_LABELS[call.function.name] ?? "Working" };

        let content: string;

        try {
          const outcome = await executeTool(call.function.name, call.function.arguments, ctx);

          if (outcome.proposal) yield { type: "draft", proposal: outcome.proposal };
          if (outcome.choices) yield { type: "choices", choices: outcome.choices };

          // Everything from the store is data written by people: cleaned, capped and labelled.
          content = JSON.stringify({ untrusted_store_data: deepClean(outcome.result) });
        } catch (error) {
          logError(`copilot: tool ${call.function.name}`, error);
          content = JSON.stringify({ error: error instanceof Error ? deepClean(error.message, 300) : "The tool failed." });
        }

        messages.push({ role: "tool", tool_call_id: call.id, content: clip(content) });
      }
    }

    yield { type: "message", text: "That took more steps than I expected, so I stopped. Try a narrower request." };
  } catch (error) {
    if (params.signal?.aborted) return;

    yield { type: "error", message: error instanceof CopilotError ? error.message : "Something went wrong while talking to the copilot." };
  }
}
