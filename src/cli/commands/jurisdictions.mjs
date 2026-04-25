import ora from "ora";

import { resolveStateDir, loadState } from "../state.mjs";
import { StatuteApiClient } from "../api/client.mjs";

export async function runJurisdictionsList(opts) {
  const cwd = process.cwd();
  const stateDir = resolveStateDir(opts.config, cwd);
  const spinner = ora("Loading jurisdictions...").start();

  try {
    const state = await loadState(stateDir);
    const apiUrl = opts.apiUrl ?? state.api_url ?? null;
    if (!apiUrl) throw new Error("STATUTE_API_URL_MISSING");

    const api = new StatuteApiClient({ apiUrl, token: opts.token, debug: opts.debug, stateDir });
    const res = await api.listJurisdictions();
    const list = res?.jurisdictions ?? [];

    spinner.succeed(`Jurisdictions: ${list.length}`);

    if (opts.json) {
      console.log(JSON.stringify(res, null, 2));
    } else {
      for (const j of list) console.log(`- ${j}`);
    }
  } catch (err) {
    spinner.fail("Failed to load jurisdictions.");
    const msg = err instanceof Error ? err.message : String(err);
    if (opts.debug) console.error(err);
    else console.error(msg);
    process.exitCode = 1;
  }
}

