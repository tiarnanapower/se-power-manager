import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { runAgent } from "@/lib/copilot/agent";
import { cleanText, createRateLimiter, looksLikeInjection } from "@/lib/copilot/guard";
import { isCopilotConfigured } from "@/lib/copilot/portkey";
import { logAudit } from "@/lib/errors/logger";
import { jsonError } from "@/lib/errors/json-error";
import { isAuthorizedForStore, NOT_AUTHORIZED_FOR_STORE_MESSAGE } from "@/lib/session/is-authorized-for-store";

const bodySchema = z.object({
  storeHash: z.string().regex(/^[a-z0-9]{3,20}$/i).optional(),
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(8000) })).min(1).max(30),
});

// Cost and abuse brakes (per server instance): per person, and per store overall.
const perUser = createRateLimiter({ limit: 20, windowMs: 5 * 60_000 });
const perStore = createRateLimiter({ limit: 150, windowMs: 60 * 60_000 });
const MAX_TOTAL_CHARS = 30_000;

// The copilot may run several tool calls per reply, so allow a longer function on Vercel.
export const maxDuration = 60;

// Streams the copilot's progress as newline-delimited JSON events.
export async function POST(request: NextRequest): Promise<NextResponse | Response> {
  // Route handlers have no built-in CSRF protection and the session cookie is
  // SameSite=None (for the control panel iframe), so only same-origin
  // requests from our own UI are accepted.
  const site = request.headers.get("sec-fetch-site");

  if (site && site !== "same-origin") return jsonError(403, "Cross-site requests are not allowed.");

  const parsed = bodySchema.safeParse(await request.json().catch(() => undefined));

  if (!parsed.success) return jsonError(400, "Invalid request.");

  if (!(await isAuthorizedForStore(parsed.data.storeHash))) return jsonError(403, NOT_AUTHORIZED_FOR_STORE_MESSAGE);
  if (!isCopilotConfigured()) return jsonError(503, "The AI copilot isn't configured. Add PORTKEY_API_KEY to the server environment.");

  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const store = parsed.data.storeHash ?? "static";
  const mine = perUser.check(`${store}:${forwarded}`);
  const all = perStore.check(store);

  if (!mine.ok || !all.ok) {
    const retry = Math.max(mine.retryAfterSec, all.retryAfterSec);
    const response = jsonError(429, `You're sending requests very quickly. Try again in ${retry} seconds.`);

    response.headers.set("Retry-After", String(retry));

    return response;
  }

  // Clean what the browser sent, and cap the whole conversation.
  const messages = parsed.data.messages.map((message) => ({ role: message.role, content: cleanText(message.content) }));

  if (messages.reduce((total, message) => total + message.content.length, 0) > MAX_TOTAL_CHARS) {
    return jsonError(413, "This conversation is too long. Start a new one.");
  }

  if (messages[messages.length - 1].role !== "user") return jsonError(400, "Invalid request.");
  if (looksLikeInjection(messages[messages.length - 1].content)) logAudit("copilot.suspicious_input", { storeHash: parsed.data.storeHash });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of runAgent({ storeHash: parsed.data.storeHash, history: messages, signal: request.signal })) {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}
