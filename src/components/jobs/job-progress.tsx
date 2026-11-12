"use client";

import { useEffect, useState } from "react";
import { estimateRemaining, formatDuration } from "@/lib/jobs/eta";
import type { Job } from "@/lib/jobs/job-store";

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;

    const timer = setInterval(() => setNow(Date.now()), 1000);

    return () => clearInterval(timer);
  }, [active]);

  return now;
}

// Bar plus a clock, so a slow first batch doesn't look like a frozen page.
export function JobProgress({ job, unit = "" }: { job: Job; unit?: string }) {
  const running = job.phase === "running";
  const now = useNow(running);
  const elapsed = (job.finishedAt ?? now) - job.startedAt;
  const left = running ? estimateRemaining({ elapsedMs: elapsed, done: job.done, total: job.total }) : undefined;
  const percent = job.total ? Math.min(100, (job.done / job.total) * 100) : 0;

  return (
    <>
      {(job.total > 0 || running) && <div className={`pp-progress${running ? " is-active" : ""}`}><span style={{ width: `${percent}%` }} /></div>}
      <div className="pp-muted" style={{ fontSize: 13 }}>
        {job.total > 0 ? `${job.done} of ${job.total}${unit ? ` ${unit}` : ""} (${Math.round(percent)}%)` : "Working"}
        {` · ${running ? "running for" : "took"} ${formatDuration(elapsed)}`}
        {left !== undefined && ` · about ${formatDuration(left)} left`}
      </div>
      {running && job.done === 0 && job.total > 0 && (
        <div className="pp-muted" style={{ fontSize: 13, marginTop: 4 }}>The first batch is the slowest part, because each product&apos;s pictures are copied. It can sit at 0% for a few minutes while it is working. A time estimate appears once the first batch is done.</div>
      )}
      {running && <div style={{ fontSize: 13, marginTop: 4, fontWeight: 600 }}>Leaving the app will stop the import.</div>}
      {job.summary && <div className="pp-muted" style={{ fontSize: 13, marginTop: 4 }}>{job.summary}</div>}
    </>
  );
}
