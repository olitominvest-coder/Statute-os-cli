import path from "node:path";
import os from "node:os";

import { pathExists, readJson, writeJsonAtomic, ensureDir } from "./util/fs.mjs";
import { CLI_CONTRACT_VERSION } from "./contracts.mjs";

export function resolveStateDir(configDirArg, cwd) {
  // If user passes an absolute path, respect it. Otherwise treat as cwd-relative.
  return path.isAbsolute(configDirArg)
    ? configDirArg
    : path.join(cwd ?? process.cwd(), configDirArg ?? ".statute");
}

export function defaultState() {
  return {
    schema_version: CLI_CONTRACT_VERSION,
    created_at: new Date().toISOString(),
    machine: { hostname: os.hostname() },
    api_url: null,
    context: { jurisdictions: [], risk_tier: "medium" },
    manifest: null,
    last_scan: null,
  };
}

export async function loadState(stateDir) {
  const filePath = path.join(stateDir, "config.json");
  if (!(await pathExists(filePath))) return defaultState();
  return await readJson(filePath);
}

export async function saveState(stateDir, state) {
  await ensureDir(stateDir);
  const filePath = path.join(stateDir, "config.json");
  await writeJsonAtomic(filePath, state);
}

