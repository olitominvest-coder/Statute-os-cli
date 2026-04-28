import fs from "node:fs/promises";
import path from "node:path";

import ora from "ora";

import { resolveStateDir, loadState, saveState } from "../state.mjs";
import { scanRepo } from "../scan/index.mjs";
import { matchFindingsToGapIds } from "../match.mjs";
import { StatuteApiClient } from "../api/client.mjs";
import { CLI_CONTRACT_VERSION } from "../contracts.mjs";
import { runPreflight } from "../preflight/engine.mjs";
import { loadPreflightConfig } from "../preflight/config.mjs";
import { writeJsonAtomic } from "../util/fs.mjs";

// Jurisdictions used when a brand-new user runs `statute scan` with no prior init.
// Broadest useful default: covers EU AI Act + GDPR which apply to most AI systems globally.
const BOOTSTRAP_JURISDICTIONS = ["EU_AI_ACT", "GDPR"];
const BOOTSTRAP_RISK_TIER = "medium";

/**
 * Auto-bootstrap the manifest on first run (free — uses GET /cli/v1/manifest, no credits).
 * Saves the result to state so all subsequent runs are instant offline.
 * Non-fatal: if the API is unreachable we continue; gaps will be empty but the scan still runs.
 */
async function maybeBootstrapManifest(state, { apiUrl, token, debug, stateDir, spinner }) {
  if (state.manifest) return; // already have one — nothing to do
  if (!apiUrl || !token) return; // no credentials — can't fetch, will hint user at end

  const jurisdictions = state.context?.jurisdictions?.length
    ? state.context.jurisdictions
    : BOOTSTRAP_JURISDICTIONS;
  const riskTier = state.context?.risk_tier ?? BOOTSTRAP_RISK_TIER;

  spinner.text = `First run — syncing manifest (${jurisdictions.join(" · ")})...`;

  try {
    const api = new StatuteApiClient({ apiUrl, token, debug, stateDir });
    const manifest = await api.getManifest({ jurisdictions, riskTier });

    state.manifest = manifest;
    state.api_url = apiUrl;
    state.context = { ...state.context, jurisdictions, risk_tier: riskTier };
    await saveState(stateDir, state);

    spinner.text = `Manifest synced (${manifest.mappings.length} controls). Scanning...`;
  } catch (err) {
    // Non-fatal: proceed without manifest; gaps will be empty but scan output is still useful.
    if (debug) console.error("[bootstrap]", err);
    spinner.text = "Scanning (metadata-only)...";
  }
}

export async function runScan(opts) {
  const cwd = process.cwd();
  const stateDir = resolveStateDir(opts.config, cwd);
  const spinner = ora("Scanning (metadata-only)...").start();

  try {
    const state = await loadState(stateDir);
    if (opts.assessmentId) {
      state.context = { ...(state.context ?? {}), assessment_id: opts.assessmentId };
      await saveState(stateDir, state);
    }

    if (opts.preflight) {
      spinner.text = "Running preflight (Databricks Clean Room)...";
      const cfg = await loadPreflightConfig({ stateDir });
      const targetPath = opts.preflightPath ?? cwd;
      const allowedPrefixes =
        (opts.allowedPrefix?.length ? opts.allowedPrefix : null) ??
        (cfg.allowed_prefixes ?? []);
      const out = await runPreflight({
        targetPath,
        config: cfg,
        allowedPrefixes,
        stateDir,
        autoAssess: opts.autoAssess === true,
        llmOverrides: {
          enabled: opts.autoAssess === true,
          provider: opts.llmProvider,
          base_url: opts.llmUrl,
          api_key: opts.llmKey,
          model: opts.llmModel,
          allow_send_code: opts.llmSendCode === true,
        },
      });
      spinner.succeed(`Preflight complete: ${out.readiness_summary.status} (${out.readiness_summary.score}/100)`);

      await writeJsonAtomic(
        path.join(stateDir, "last-preflight.json"),
        { ...out, generated_at: new Date().toISOString() },
      );

      if (opts.out) {
        const outPath = path.isAbsolute(opts.out) ? opts.out : path.join(cwd, opts.out);
        await fs.writeFile(outPath, JSON.stringify(out, null, 2) + "\n", "utf8");
      }

      if (opts.json) {
        console.log(JSON.stringify(out, null, 2));
      } else {
        const worst = out.security_diff[0];
        if (worst) {
          console.log(
            `[!] ${out.readiness_summary.status}: Line ${worst.line_number} - ${worst.violation_type} (${worst.severity}). Score: ${out.readiness_summary.score}/100.`,
          );
        } else {
          console.log(`[✓] PASS: No preflight violations detected. Score: ${out.readiness_summary.score}/100.`);
        }
      }

      return;
    }

    const apiUrl = opts.apiUrl ?? state.api_url ?? null;

    // Bootstrap manifest on first run (free, no credits, saves for all future runs).
    if (!opts.offline) {
      await maybeBootstrapManifest(state, {
        apiUrl,
        token: opts.token,
        debug: opts.debug,
        stateDir,
        spinner,
      });
    }

    spinner.text = "Scanning (metadata-only)...";
    const scan = await scanRepo({ repoRoot: cwd, stateDir });

    // Offline match against manifest (instant, zero-trust, no credits).
    let gaps = matchFindingsToGapIds(scan.findings, state.manifest ?? null);

    // Online match: only fall back to the paid match endpoint if we still have no gaps
    // after a manifest exists. This is now rare — typically only when control_ids don't
    // map in the cached manifest (e.g., project uses a jurisdiction not in defaults).
    if (!opts.offline && gaps.length === 0 && state.manifest && apiUrl) {
      const api = new StatuteApiClient({ apiUrl, token: opts.token, debug: opts.debug, stateDir });
      await api.assertHasScanCredits();
      const res = await api.match({
        schema_version: CLI_CONTRACT_VERSION,
        context: state.context,
        project: scan.project,
        findings: scan.findings,
      });
      gaps = res.gaps;
    }

    const result = { ...scan, gaps, context: state.context };
    state.last_scan = result;
    await saveState(stateDir, state);

    spinner.succeed(`Scan complete: ${gaps.length} gap(s) matched.`);

    if (opts.out) {
      const outPath = path.isAbsolute(opts.out) ? opts.out : path.join(cwd, opts.out);
      await fs.writeFile(outPath, JSON.stringify(result, null, 2) + "\n", "utf8");
    }

    if (!opts.json) {
      if (gaps.length > 0) {
        console.log(`Matched gaps: ${gaps.map((g) => g.gap_id).join(", ")}`);
        console.log("Next: run `statute fix` to apply a codemod, or `statute explain <gap-id>` to understand a gap.");
      } else if (!state.manifest) {
        // Couldn't bootstrap (no credentials) — explain why gaps are empty.
        console.log("No gaps matched (no manifest). To enable gap detection:");
        console.log("  1. Set STATUTE_API_URL and STATUTE_API_TOKEN, then re-run.");
        console.log("  2. Or run `statute init` to configure interactively.");
      } else {
        console.log("No governance gaps detected. Your codebase looks clean for the scanned controls.");
      }
    } else {
      console.log(JSON.stringify(result, null, 2));
    }
  } catch (err) {
    spinner.fail("Scan failed.");
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith("NO_CREDITS:")) {
      console.error("No credits available to run scans. Purchase credits or contact your Statute OS admin.");
    } else if (opts.debug) {
      console.error(err);
    } else {
      console.error(msg);
    }
    process.exitCode = 1;
  }
}
