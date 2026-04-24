import path from "node:path";

import { pathExists, readJson } from "./util/fs.mjs";

export const PLATFORMS = ["databricks", "snowflake", "aws", "gcp", "azure"];

export function resolveIntegrationProfilePath(stateDir, key) {
  return path.join(stateDir, "integrations", `${key}.json`);
}

export async function loadIntegrationProfile(stateDir, key) {
  const filePath = resolveIntegrationProfilePath(stateDir, key);
  if (!(await pathExists(filePath))) {
    throw new Error(`INTEGRATION_PROFILE_NOT_FOUND:${key}`);
  }
  return await readJson(filePath);
}

export function requireIntegrationKey(opts) {
  const key = opts.integrationKey ?? null;
  if (!key) throw new Error("INTEGRATION_KEY_REQUIRED");
  return key;
}

export function resolveMode(opts) {
  const local = opts.local === true;
  const server = opts.server === true;
  if (local && server) throw new Error("MODE_CONFLICT: choose only one of --local or --server");
  // Default: local-only scan unless server explicitly requested.
  return server ? "server" : "local";
}

export function getAssessmentId(opts, state) {
  return opts.assessmentId ?? state?.context?.assessment_id ?? null;
}

export function pickServerConnections(profile) {
  const connections = profile?.server?.connections ?? null;
  if (!connections) throw new Error("SERVER_CONNECTIONS_MISSING");
  /** @type {Record<string,string>} */
  const out = {};
  for (const p of PLATFORMS) {
    const id = connections[p];
    if (typeof id === "string" && id.length) out[p] = id;
  }
  if (Object.keys(out).length === 0) throw new Error("SERVER_CONNECTIONS_EMPTY");
  return out;
}

