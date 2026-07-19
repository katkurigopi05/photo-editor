import type { ExportError, ExportPlan } from "./plan.js";

/**
 * Export job state machine — a stateful job that lives **outside** the command
 * engine (like playback transport). It reports progress against the immutable
 * project version the plan was built from, so exports are reproducible and never
 * depend on live UI/playback state. All transitions are pure.
 */

export type ExportStatus =
  "running" | "completed" | "failed" | "cancelled" | "timed_out";

export interface ExportJob {
  status: ExportStatus;
  framesTotal: number;
  framesDone: number;
  /** The project version this export is bound to. */
  projectVersion: number;
  error: ExportError | null;
}

export function startExport(plan: ExportPlan): ExportJob {
  return {
    status: "running",
    framesTotal: plan.framesTotal,
    framesDone: 0,
    projectVersion: plan.projectVersion,
    error: null,
  };
}

/**
 * Distinct from `failExport`: "the export hung" and "the export failed" are
 * different, actionable facts for a caller (a stuck encoder vs. a rejected
 * input) — the reference cloud architecture's job state machine keeps these
 * separate, and there's no reason a local job should collapse them.
 */
export function timeOutExport(job: ExportJob): ExportJob {
  if (job.status !== "running") return job;
  return {
    ...job,
    status: "timed_out",
    error: { code: "TIMED_OUT", message: "export timed out" },
  };
}

/** Advance progress. No-op once the job has terminated. Reaching the total
 * frame count completes the job. */
export function advanceExport(job: ExportJob, framesDone: number): ExportJob {
  if (job.status !== "running") return job;
  const clamped = Math.max(0, Math.min(framesDone, job.framesTotal));
  const status: ExportStatus =
    clamped >= job.framesTotal ? "completed" : "running";
  return { ...job, framesDone: clamped, status };
}

export function failExport(job: ExportJob, error: ExportError): ExportJob {
  if (job.status !== "running") return job;
  return { ...job, status: "failed", error };
}

/** Cancel a running job. A cancelled job is never `completed`, so consumers
 * must not treat its (partial) progress as a finished output file. */
export function cancelExport(job: ExportJob): ExportJob {
  if (job.status !== "running") return job;
  return { ...job, status: "cancelled" };
}

export function isTerminal(job: ExportJob): boolean {
  return job.status !== "running";
}

/** True only when the job produced a complete, usable output. */
export function hasCompletedOutput(job: ExportJob): boolean {
  return job.status === "completed";
}
