import path from "node:path";
import fs from "node:fs/promises";

import { pathExists } from "../util/fs.mjs";

async function readOptionalJson(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function bool(v) {
  if (v === true) return true;
  if (v === false) return false;
  return null;
}

export async function scanAgentGovernance({ repoRoot, stateDir, signals }) {
  const agentPath = stateDir ? path.join(stateDir, "agent.json") : null;
  const cfg = agentPath && (await pathExists(agentPath)) ? await readOptionalJson(agentPath) : {};

  const purposeDocumented =
    bool(cfg?.purpose_documented) ?? (signals.hasPurposeDocs ? true : null);
  const systemPromptDocumented =
    bool(cfg?.system_prompt_documented) ?? (signals.hasPromptsDir ? true : null);
  const hasHumanOversight = bool(cfg?.has_human_oversight);
  const hasOutputFiltering = bool(cfg?.has_output_filtering);
  const outputAuditLog =
    bool(cfg?.output_audit_log) ??
    (signals.hasAuditModule || signals.hasAuditWrapperUsage ? true : null);

  const findings = [];

  findings.push({
    control_id: "AGENT-001",
    status: purposeDocumented === true ? "pass" : purposeDocumented === false ? "fail" : "warning",
    severity: "high",
    evidence_meta: `purpose_documented=${purposeDocumented ?? "not_disclosed"}`,
    artifacts: [],
  });

  findings.push({
    control_id: "AGENT-002",
    status:
      systemPromptDocumented === true ? "pass" : systemPromptDocumented === false ? "fail" : "warning",
    severity: "medium",
    evidence_meta: `system_prompt_documented=${systemPromptDocumented ?? "not_disclosed"}`,
    artifacts: [],
  });

  findings.push({
    control_id: "AGENT-003",
    status: hasHumanOversight === true ? "pass" : hasHumanOversight === false ? "fail" : "warning",
    severity: "high",
    evidence_meta: `has_human_oversight=${hasHumanOversight ?? "not_disclosed"}`,
    artifacts: [],
  });

  findings.push({
    control_id: "AGENT-004",
    status: hasOutputFiltering === true ? "pass" : hasOutputFiltering === false ? "fail" : "warning",
    severity: "high",
    evidence_meta: `has_output_filtering=${hasOutputFiltering ?? "not_disclosed"}`,
    artifacts: [],
  });

  findings.push({
    control_id: "AGENT-006",
    status: outputAuditLog === true ? "pass" : outputAuditLog === false ? "fail" : "warning",
    severity: "medium",
    evidence_meta: `output_audit_log=${outputAuditLog ?? "not_disclosed"}`,
    artifacts: [],
  });

  // Lightweight model card presence signal (aligns with AGENT-MC-001)
  const hasModelCard = signals.hasModelCard;
  findings.push({
    control_id: "AGENT-MC-001",
    status: hasModelCard ? "pass" : "warning",
    severity: "high",
    evidence_meta: `model_card=${hasModelCard}`,
    artifacts: [],
  });

  return findings;
}
