import { describe, expect, it } from "vitest";
import { estimateRemaining, formatDuration } from "./eta";

describe("formatDuration", () => {
  it("writes seconds, minutes and hours", () => {
    expect(formatDuration(4000)).toBe("4s");
    expect(formatDuration(125_000)).toBe("2m 05s");
    expect(formatDuration(3_660_000)).toBe("1h 01m");
    expect(formatDuration(-5)).toBe("0s");
  });
});

describe("estimateRemaining", () => {
  it("projects from the pace so far", () => {
    expect(estimateRemaining({ elapsedMs: 60_000, done: 10, total: 40 })).toBe(180_000);
  });

  it("gives no estimate before anything has finished or once everything has", () => {
    expect(estimateRemaining({ elapsedMs: 60_000, done: 0, total: 40 })).toBeUndefined();
    expect(estimateRemaining({ elapsedMs: 60_000, done: 40, total: 40 })).toBeUndefined();
    expect(estimateRemaining({ elapsedMs: 60_000, done: 5, total: 0 })).toBeUndefined();
  });
});
