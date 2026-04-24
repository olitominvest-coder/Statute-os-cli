import path from "node:path";
import fs from "node:fs/promises";

import { walkFiles } from "../util/fs.mjs";
import { computeSignals } from "./signals.mjs";
import { scanAgentGovernance } from "./agent.mjs";

function pickPackageManager() {
  // Best-effort; can be refined later.
  return "npm";
}

async function readPackageJson(repoRoot) {
  try {
    const raw = await fs.readFile(path.join(repoRoot, "package.json"), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function detectAiSdks(pkgJson) {
  const deps = { ...(pkgJson?.dependencies ?? {}), ...(pkgJson?.devDependencies ?? {}) };
  const names = Object.keys(deps);
  /** @type {string[]} */
  const ai = [];
  if (names.includes("openai")) ai.push("openai");
  if (names.includes("@anthropic-ai/sdk")) ai.push("anthropic");
  if (names.some((n) => n.startsWith("langchain") || n.startsWith("@langchain/"))) ai.push("langchain");
  return ai;
}

function inferLanguagesFromFiles(files) {
  const exts = new Set(files.map((f) => path.extname(f).slice(1)).filter(Boolean));
  /** @type {string[]} */
  const langs = [];
  if (exts.has("ts") || exts.has("tsx")) langs.push("ts");
  if (exts.has("js") || exts.has("jsx") || exts.has("mjs") || exts.has("cjs")) langs.push("js");
  if (exts.has("py")) langs.push("py");
  if (exts.has("tf")) langs.push("terraform");
  return langs;
}

function hasAny(files, predicate) {
  return files.some(predicate);
}

export async function scanRepo({ repoRoot, stateDir } = {}) {
  if (!repoRoot) repoRoot = process.cwd();
  const files = await walkFiles(repoRoot);
  const pkgJson = await readPackageJson(repoRoot);
  const aiSdks = detectAiSdks(pkgJson);
  const signals = computeSignals({ repoRoot, files, aiSdks });

  // Evidence that an audit wrapper is actually used in source (metadata-only output).
  // Limit reads to small-ish source files to keep scans fast.
  const sourceCandidates = files.filter((f) =>
    /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(f) && !/\.d\.ts$/.test(f),
  );
  for (const f of sourceCandidates.slice(0, 500)) {
    try {
      const stat = await fs.stat(f);
      if (stat.size > 512_000) continue;
      const txt = await fs.readFile(f, "utf8");
      if (txt.includes("auditLLMCall(")) {
        signals.hasAuditWrapperUsage = true;
      }
      if (txt.includes("langchain") || txt.includes("@langchain/")) {
        signals.hasLangChainUsage = true;
      }
      if (txt.includes("StatuteHITLCallbackHandler") || txt.includes("./statute/hitl")) {
        signals.hasHitlHandlerUsage = true;
      }
      if (signals.hasAuditWrapperUsage && signals.hasHitlHandlerUsage && signals.hasLangChainUsage) break;
    } catch {
      // ignore
    }
  }
  const languages = inferLanguagesFromFiles(files);
  const iac = [];
  if (hasAny(files, (f) => f.endsWith(".tf"))) iac.push("terraform");
  if (hasAny(files, (f) => f.endsWith("template.yaml") || f.endsWith("template.yml"))) iac.push("cloudformation");

  // Governance-as-Code starter controls (local-only for now)
  const findings = [];

  // CODE-AI-LOG-001: LLM calls are audited
  // Heuristic: look for a local audit module OR an audit wrapper usage.
  const hasAuditModule = signals.hasAuditModule || signals.hasAuditWrapperUsage;
  findings.push({
    control_id: "CODE-AI-LOG-001",
    status: hasAuditModule ? "pass" : "fail",
    severity: "high",
    evidence_meta: `audit_present=${hasAuditModule}, audit_usage=${signals.hasAuditWrapperUsage}, ai_sdks=${aiSdks.join("|") || "none"}`,
    artifacts: [],
  });

  // CODE-AI-PROMPT-001: system prompts are file-backed (versioned)
  const hasPromptsDir = signals.hasPromptsDir;
  findings.push({
    control_id: "CODE-AI-PROMPT-001",
    status: hasPromptsDir ? "pass" : "warning",
    severity: "medium",
    evidence_meta: `prompts_dir=${hasPromptsDir}`,
    artifacts: [],
  });

  // CODE-LANGCHAIN-HITL-001: LangChain agents include HITL callbacks
  const langchainActive = signals.hasLangChainDep || signals.hasLangChainUsage;
  const hitlPresent = signals.hasHitlHandlerUsage;
  findings.push({
    control_id: "CODE-LANGCHAIN-HITL-001",
    status: !langchainActive ? "skipped" : hitlPresent ? "pass" : "fail",
    severity: "high",
    evidence_meta: `langchain=${langchainActive}, hitl_handler=${hitlPresent}`,
    artifacts: [],
  });

  // Agent Governance Scanner (ported to local, still metadata-only)
  findings.push(...(await scanAgentGovernance({ repoRoot, stateDir, signals })));

  const project = {
    repo_root_hint: path.basename(repoRoot),
    package_manager: pickPackageManager(),
    languages,
    iac,
    ai_sdks: aiSdks,
  };

  return {
    project,
    findings,
    scanned_at: new Date().toISOString(),
  };
}
