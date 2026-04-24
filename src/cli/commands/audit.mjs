import ora from "ora";

import { runScan } from "./scan.mjs";
import { runFix } from "./fix.mjs";
import { resolveStateDir, loadState } from "../state.mjs";
import { resolveMode, requireIntegrationKey, loadIntegrationProfile, pickServerConnections, getAssessmentId } from "../integrations.mjs";
import { StatuteApiClient } from "../api/client.mjs";

export async function runAudit(opts) {
  const spinner = ora("Auditing...").start();
  spinner.stop();

  // Optional: trigger server-side scans (Databricks/Snowflake/AWS/GCP/Azure) before local audit.
  const stateDir = resolveStateDir(opts.config, process.cwd());
  const state = await loadState(stateDir);
  const mode = resolveMode(opts);

  if (mode === "server") {
    const integrationKey = requireIntegrationKey(opts);
    const profile = await loadIntegrationProfile(stateDir, integrationKey);
    const assessmentId = getAssessmentId(opts, state);
    if (!assessmentId) throw new Error("ASSESSMENT_ID_REQUIRED_FOR_SERVER_MODE");

    const apiUrl = opts.apiUrl ?? state.api_url ?? null;
    if (!apiUrl) throw new Error("STATUTE_API_URL_MISSING");

    const api = new StatuteApiClient({ apiUrl, token: opts.token, debug: opts.debug, stateDir });
    await api.assertHasScanCredits();

    const connections = pickServerConnections(profile);
    const s = ora("Triggering server scans...").start();
    try {
      for (const [platform, connectionId] of Object.entries(connections)) {
        s.text = `Triggering ${platform} scan...`;
        await api.triggerScan({ assessmentId, connectionId, runAll: true });
      }
      s.succeed("Server scans triggered.");
    } catch (e) {
      s.fail("Failed to trigger server scans.");
      throw e;
    }
  }

  // Step 1: scan
  await runScan(opts);

  if (!opts.fix) return;

  // Step 2: fix (uses last_scan produced by scan)
  await runFix(opts);
}
