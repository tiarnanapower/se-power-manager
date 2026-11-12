"use client";

import Link from "next/link";
import { JobProgress } from "@/components/jobs/job-progress";
import { dismissJob, requestCancel, useJobs } from "@/lib/jobs/job-store";

// Floats over every page, so an import started elsewhere stays visible and one click gets back to it.
export function JobDock() {
  const jobs = useJobs();

  if (jobs.length === 0) return null;

  return (
    <div className="pp-dock" aria-live="polite">
      {jobs.map((job) => (
        <div key={job.id} className="pp-card pp-dock__job">
          <div className="pp-dock__head">
            <strong>{job.title}</strong>
            {job.phase === "done" && <button type="button" className="pp-btn pp-btn--icon" aria-label="Dismiss" onClick={() => dismissJob(job.id)}>×</button>}
          </div>
          <div className="pp-muted" style={{ fontSize: 13, marginBottom: 2 }}>{job.phase === "running" ? job.stage : job.error ? "Stopped" : "Finished"}</div>
          <JobProgress job={job} />
          {job.error && <div className="pp-msg pp-msg--err">{job.error}</div>}
          <div className="pp-dock__actions">
            <Link href={job.href} className="pp-btn">Open</Link>
            {job.phase === "running" && <button type="button" className="pp-btn" disabled={job.cancelRequested} onClick={() => requestCancel(job.id)}>{job.cancelRequested ? "Stopping…" : "Stop after this batch"}</button>}
          </div>
        </div>
      ))}
    </div>
  );
}
