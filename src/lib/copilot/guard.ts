// Pure safety helpers for the copilot: cleaning untrusted text, spotting
// obvious prompt-injection attempts, rate limiting and risk warnings.
import { rewardKind, rewardValue } from "@/lib/promo-calendar/describe";
import type { Promotion } from "@/lib/promotions/types";

// Control characters, zero-width and bidirectional-override characters: used to
// hide instructions from people while the model still reads them.
const INVISIBLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;

export function cleanText(value: string, max = 8000): string {
  return value.replace(INVISIBLE, "").replace(/[ \t]{3,}/g, "  ").slice(0, max);
}

// Cleans every string inside store data before the model sees it. Store text
// (promotion names, banner copy) is written by people and must be treated as
// data: it is trimmed, stripped of hidden characters and length-capped.
export function deepClean<T>(value: T, max = 300): T {
  if (typeof value === "string") return cleanText(value, max).trim() as T;
  if (Array.isArray(value)) return value.map((item) => deepClean(item, max)) as T;

  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, deepClean(item, max)])) as T;
  }

  return value;
}

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+|any\s+|the\s+|your\s+)?(previous|prior|above|earlier)\s+(instructions|rules|prompts?)/i,
  /(reveal|show|print|repeat|leak|output)\b.{0,40}\b(system\s+prompt|instructions|api\s*key|secret|token|password|env)/i,
  /\b(developer|god|admin|dan)\s+mode\b|\bjailbreak\b/i,
  /(disable|skip|bypass|without)\b.{0,30}\b(confirm|confirmation|review|approval|safeguards?)/i,
  /you\s+are\s+now\b/i,
];

// For logging only: a match is never blocked, because the copilot is safe by
// construction (it can only propose, and a person confirms).
export function looksLikeInjection(text: string): boolean {
  return INJECTION_PATTERNS.some((pattern) => pattern.test(text));
}

export interface RateLimiter {
  check(key: string, now?: number): { ok: boolean; retryAfterSec: number };
}

// Sliding-window limiter, in memory. Per server instance, so it is a
// best-effort brake on cost and abuse rather than a global guarantee.
export function createRateLimiter({ limit, windowMs }: { limit: number; windowMs: number }): RateLimiter {
  const hits = new Map<string, number[]>();

  return {
    check(key, now = Date.now()) {
      const recent = (hits.get(key) ?? []).filter((time) => now - time < windowMs);

      if (recent.length >= limit) {
        hits.set(key, recent);

        return { ok: false, retryAfterSec: Math.max(1, Math.ceil((windowMs - (now - recent[0])) / 1000)) };
      }

      recent.push(now);
      hits.set(key, recent);

      if (hits.size > 5000) {
        for (const [otherKey, times] of hits) {
          if (times.every((time) => now - time >= windowMs)) hits.delete(otherKey);
        }
      }

      return { ok: true, retryAfterSec: 0 };
    },
  };
}

// Extra warnings on a draft card for changes that are unusually risky.
export function riskWarnings(promotion: Promotion): string[] {
  const warnings: string[] = [];
  const kind = rewardKind(promotion);
  const value = rewardValue(promotion);

  if (kind === "percent" && value !== null) {
    if (value >= 100) warnings.push("100% off makes the discounted items free.");
    else if (value >= 40) warnings.push(`Deep discount: ${value}% off. Check this is intended.`);
  }

  if (!promotion.end_date) warnings.push("It has no end date, so it keeps running until someone disables it.");
  if (promotion.redemption_type === "COUPON" && !promotion.max_uses && kind === "percent" && (value ?? 0) >= 30) {
    warnings.push("This coupon has no usage limit, so anyone with the code can use it repeatedly.");
  }

  return warnings;
}
