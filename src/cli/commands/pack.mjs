import fs from "node:fs/promises";
import path from "node:path";

import ora from "ora";

import { resolveStateDir, loadState } from "../state.mjs";
import { StatuteApiClient } from "../api/client.mjs";
import { ensureDir, pathExists, readJson } from "../util/fs.mjs";

function packPath(stateDir, jurisdictionCode) {
  return path.join(stateDir, "packs", `${jurisdictionCode}.json`);
}

export async function runPackPull(opts) {
  const cwd = process.cwd();
  const stateDir = resolveStateDir(opts.config, cwd);
  const spinner = ora("Pulling jurisdiction pack...").start();

  try {
    const jurisdiction = String(opts.jurisdiction ?? "").trim();
    if (!jurisdiction) throw new Error("JURISDICTION_REQUIRED");

    const state = await loadState(stateDir);
    const apiUrl = opts.apiUrl ?? state.api_url ?? null;
    if (!apiUrl) throw new Error("STATUTE_API_URL_MISSING");

    const api = new StatuteApiClient({ apiUrl, token: opts.token, debug: opts.debug, stateDir });
    const pack = await api.getPack(jurisdiction);

    await ensureDir(path.join(stateDir, "packs"));
    const outPath = packPath(stateDir, jurisdiction);
    await fs.writeFile(outPath, JSON.stringify(pack, null, 2) + "\n", "utf8");

    spinner.succeed(`Saved: ${outPath}`);

    if (opts.json) console.log(JSON.stringify({ ok: true, path: outPath }, null, 2));
  } catch (err) {
    spinner.fail("Pack pull failed.");
    const msg = err instanceof Error ? err.message : String(err);
    if (opts.debug) console.error(err);
    else console.error(msg);
    process.exitCode = 1;
  }
}

export async function runPackShow(opts) {
  const cwd = process.cwd();
  const stateDir = resolveStateDir(opts.config, cwd);

  try {
    const jurisdiction = String(opts.jurisdiction ?? "").trim();
    if (!jurisdiction) throw new Error("JURISDICTION_REQUIRED");

    const p = packPath(stateDir, jurisdiction);
    if (!(await pathExists(p))) throw new Error(`PACK_NOT_FOUND:${p}`);
    const json = await readJson(p);
    console.log(JSON.stringify(json, null, 2));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (opts.debug) console.error(err);
    else console.error(msg);
    process.exitCode = 1;
  }
}

