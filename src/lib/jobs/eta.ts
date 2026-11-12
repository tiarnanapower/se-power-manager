// Time wording for long imports. Pure, so it can be tested without a browser.

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));

  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);

  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;

  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

// Time left, from the pace so far. Nothing is promised until at least one piece has finished.
export function estimateRemaining(input: { elapsedMs: number; done: number; total: number }): number | undefined {
  const { elapsedMs, done, total } = input;

  if (done <= 0 || total <= 0 || done >= total || elapsedMs <= 0) return undefined;

  return (elapsedMs / done) * (total - done);
}
