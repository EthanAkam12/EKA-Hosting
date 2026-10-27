// In-memory background jobs for slow AI calls. The browser starts a job and
// polls it, so long generations never hit HTTP timeouts.

import crypto from "node:crypto";

const jobs = new Map();
const KEEP_MS = 30 * 60 * 1000;

export function startJob(kind, siteId, run) {
  const id = crypto.randomBytes(8).toString("hex");
  const job = { id, kind, siteId, status: "running", progress: { chars: 0 }, result: null, error: null, startedAt: Date.now(), finishedAt: null };
  jobs.set(id, job);
  Promise.resolve()
    // Raw AI text (`text`) stays on the server; only counts and previews are shown.
    .then(() => run(({ text, ...progress }) => Object.assign(job.progress, progress)))
    .then((result) => { job.status = "done"; job.result = result; })
    .catch((err) => { job.status = "error"; job.error = err?.message || String(err); console.error(`[job ${kind}]`, err); })
    .finally(() => {
      job.finishedAt = Date.now();
      setTimeout(() => jobs.delete(id), KEEP_MS).unref();
    });
  return job;
}

export function getJob(id) {
  return jobs.get(id) || null;
}

export function publicJob(job) {
  return {
    id: job.id,
    kind: job.kind,
    siteId: job.siteId,
    status: job.status,
    progress: job.progress,
    result: job.result,
    error: job.error,
    elapsedMs: (job.finishedAt || Date.now()) - job.startedAt,
  };
}
