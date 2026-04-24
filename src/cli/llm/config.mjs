import path from "node:path";
import fs from "node:fs/promises";

import { pathExists, readJson } from "../util/fs.mjs";
import { LlmConfigSchema } from "./schema.mjs";

export async function loadLlmConfig({ stateDir, overrides }) {
  const filePath = path.join(stateDir, "llm.json");
  let base = {};
  if (await pathExists(filePath)) {
    try {
      base = await readJson(filePath);
    } catch {
      base = {};
    }
  }

  const cleanedOverrides = {};
  for (const [k, v] of Object.entries(overrides ?? {})) {
    if (v !== undefined) cleanedOverrides[k] = v;
  }

  const merged = { ...base, ...cleanedOverrides };
  return LlmConfigSchema.parse(merged);
}

export async function loadSystemPrompt({ stateDir, cfg }) {
  if (!cfg.system_prompt_path) return null;
  const abs = path.isAbsolute(cfg.system_prompt_path)
    ? cfg.system_prompt_path
    : path.join(stateDir, cfg.system_prompt_path);
  try {
    return await fs.readFile(abs, "utf8");
  } catch {
    return null;
  }
}
