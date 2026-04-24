import path from "node:path";

import ora from "ora";
import inquirer from "inquirer";

import { resolveStateDir, loadState, saveState } from "../state.mjs";
import { StatuteApiClient } from "../api/client.mjs";

const DEFAULT_JURISDICTIONS = ["EU_AI_ACT", "GDPR", "NIST_AI_RMF", "NYC_LL_144", "QC_LAW25"];

function parseCsv(value) {
  return String(value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function runInit(opts) {
  const cwd = process.cwd();
  const stateDir = resolveStateDir(opts.config, cwd);
  const spinner = ora("Initializing Statute OS CLI...").start();

  try {
    const state = await loadState(stateDir);
    const apiUrl = opts.apiUrl ?? state.api_url ?? null;
    const token = opts.token ?? null;

    spinner.stop();

    const jurisdictions =
      opts.jurisdictions ? parseCsv(opts.jurisdictions) : state.context?.jurisdictions ?? [];
    const riskTier = opts.riskTier ?? state.context?.risk_tier ?? "medium";
    const assessmentId = opts.assessmentId ?? state.context?.assessment_id ?? null;

    const answers = await inquirer.prompt([
      {
        type: "checkbox",
        name: "jurisdictions",
        message:
          "Jurisdictions in scope (use ↑/↓ to move, Space to select multiple, Enter to confirm)",
        choices: DEFAULT_JURISDICTIONS.map((j) => ({ name: j, value: j, checked: jurisdictions.includes(j) })),
        validate: (v) => (v?.length ? true : "Select at least one jurisdiction."),
      },
      {
        type: "list",
        name: "risk_tier",
        message: "Risk tier",
        choices: ["low", "medium", "high"],
        default: riskTier,
      },
      {
        type: "input",
        name: "assessment_id",
        message: "Assessment ID (optional; UUID)",
        default: assessmentId ?? "",
      },
      {
        type: "input",
        name: "api_url",
        message: "Statute OS API URL (leave blank for offline-only)",
        default: apiUrl ?? "",
      },
    ]);

    const next = {
      ...state,
      api_url: answers.api_url?.trim() || null,
      context: {
        jurisdictions: answers.jurisdictions,
        risk_tier: answers.risk_tier,
        assessment_id: answers.assessment_id?.trim() || undefined,
      },
      updated_at: new Date().toISOString(),
    };

    await saveState(stateDir, next);

    if (next.api_url) {
      const s2 = ora("Syncing manifest...").start();
      const api = new StatuteApiClient({ apiUrl: next.api_url, token, debug: opts.debug, stateDir });

      // If an assessment id is provided, prefer the canonical context from the server.
      if (next.context?.assessment_id) {
        try {
          const a = await api.getAssessment(next.context.assessment_id);
          const aiSystem = a?.assessment?.ai_system ?? null;
          if (aiSystem?.jurisdictions?.length) next.context.jurisdictions = aiSystem.jurisdictions;
          if (aiSystem?.risk_tier) next.context.risk_tier = aiSystem.risk_tier;
        } catch (e) {
          // Non-fatal; user can still run with local context.
          if (opts.debug) console.error(e);
        }
      }

      const manifest = await api.getManifest({
        jurisdictions: next.context.jurisdictions,
        riskTier: next.context.risk_tier,
      });
      next.manifest = manifest;
      await saveState(stateDir, next);
      s2.succeed(`Manifest synced (${manifest.mappings.length} mappings).`);
    }

    if (!opts.json) {
      console.log(`Initialized. State: ${path.relative(cwd, path.join(stateDir, "config.json"))}`);
      console.log("Next: run `statute scan`.");
    } else {
      console.log(JSON.stringify({ ok: true, state_dir: stateDir }, null, 2));
    }
  } catch (err) {
    spinner.fail("Init failed.");
    if (opts.debug) console.error(err);
    process.exitCode = 1;
  }
}
