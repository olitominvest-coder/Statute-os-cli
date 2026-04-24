import { ingestPreflightTarget } from "./ingest.mjs";
import { detectSecurityDiff } from "./detect.mjs";
import { detectUseCase, computeCompliancePrefill } from "./prefill.mjs";
import { PreflightOutputSchema } from "./schema.mjs";
import { buildPreflightFeatureSummary } from "../llm/summary.mjs";
import { loadLlmConfig, loadSystemPrompt } from "../llm/config.mjs";
import { LocalLlmClient } from "../llm/client.mjs";

function computeScore(diff) {
  let score = 100;
  for (const d of diff) {
    if (d.severity === "CRITICAL") score -= 25;
    else if (d.severity === "MEDIUM") score -= 10;
    else score -= 3;
  }
  return Math.max(0, Math.min(100, score));
}

function computeStatus(diff) {
  if (diff.some((d) => d.severity === "CRITICAL")) return "FAIL";
  if (diff.length > 0) return "WARN";
  return "PASS";
}

export async function runPreflight({ targetPath, config, allowedPrefixes, stateDir, llmOverrides, autoAssess }) {
  const { records, files } = await ingestPreflightTarget(targetPath);
  const combinedText = records.map((r) => r.code).join("\n");
  const securityDiff = detectSecurityDiff({ records, config, allowedPrefixes });
  let detectedUseCase = detectUseCase(combinedText);

  const score = computeScore(securityDiff);
  const status = computeStatus(securityDiff);

  const criticalCount = securityDiff.filter((d) => d.severity === "CRITICAL").length;
  let compliance = computeCompliancePrefill({
    detectedUseCase,
    diffCount: securityDiff.length,
    criticalCount,
  });

  if (autoAssess && stateDir) {
    const llmCfg = await loadLlmConfig({ stateDir, overrides: llmOverrides });
    if (llmCfg.enabled) {
      const featureSummary = buildPreflightFeatureSummary({ records, securityDiff });
      const systemPromptOverride = await loadSystemPrompt({ stateDir, cfg: llmCfg });
      const client = new LocalLlmClient({ cfg: llmCfg, stateDir, systemPromptOverride });
      try {
        const rawCode = llmCfg.allow_send_code ? combinedText : null;
        const res = await client.autoAssess({ featureSummary, rawCode });
        detectedUseCase = res.detected_use_case;
        compliance = res.compliance_prefill;
      } catch {
        // fail closed: keep deterministic outputs
      }
    }
  }

  const output = {
    readiness_summary: {
      score,
      status,
      detected_use_case: detectedUseCase,
    },
    security_diff: securityDiff,
    compliance_prefill: compliance,
    nudge: "Need an auditor-ready PDF? Run 'statute report --pdf' (Pro Feature).",
    _meta: {
      scanned_files: files,
    },
  };

  // Strict contract: strip _meta before returning (CLI can keep it internally).
  const { _meta, ...json } = output;
  return PreflightOutputSchema.parse(json);
}
