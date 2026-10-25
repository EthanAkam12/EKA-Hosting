// Shows progress while a site's files upload to the customer's hosting.
// Resolves with the refreshed site meta (so the Site tab can show the result).

import { api, waitForJob, toast } from "../ui.js";

export async function followDeploy(siteId, jobId) {
  const note = document.getElementById("save-state");
  try {
    const result = await waitForJob(jobId, (job) => {
      const { done = 0, total = 0 } = job.progress || {};
      if (note) note.textContent = total ? `Uploading to hosting… ${done} of ${total}` : "Connecting to hosting…";
    });
    toast(result.uploaded || result.deleted
      ? `Uploaded to your hosting (${result.uploaded} file${result.uploaded === 1 ? "" : "s"} updated).`
      : "Your hosting already has the latest version.");
  } catch (err) {
    toast(`Upload to hosting failed: ${err.message}`, { error: true, ms: 6000 });
  }
  if (note) note.textContent = "All changes saved";
  const { meta } = await api(`/sites/${siteId}`).catch(() => ({ meta: null }));
  return meta;
}
