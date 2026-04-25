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

export async function runScan(opts) {
  const cwd = process.cwd();
  const stateDir = resolveStateDir(opts.config, cwd);
  const spinner = ora("Scanning (metadata-only)...").start();

  function summarizeFindings(findings) {
    const relevant = (findings ?? []).filter((f) => f.status === "fail" || f.status === "warning");
    const fail = relevant.filter((f) => f.status === "fail").length;
    const warning = relevant.filter((f) => f.status === "warning").length;
    return { relevant, fail, warning };
  }

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

      const hasTableRefs = out.security_diff?.some((d) => Array.isArray(d.table_refs) && d.table_refs.length > 0);
      if (hasTableRefs) {
        console.error(
          "warning: detected table references are best-effort hints; double-check results (dynamic SQL/macros/ORMs can change actual tables).",
        );
      }

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
    const scan = await scanRepo({ repoRoot: cwd, stateDir });
    const manifest = state.manifest ?? null;

    // Offline match (preferred zero-trust default)
    let gaps = matchFindingsToGapIds(scan.findings, manifest);

    // Optional online match when manifest missing or user requests freshness
    if (!opts.offline && (gaps.length === 0 || !manifest) && apiUrl) {
      const api = new StatuteApiClient({
        apiUrl,
        token: opts.token,
        debug: opts.debug,
        stateDir,
      });
      await api.assertHasScanCredits();
      const requestBody = {
        schema_version: CLI_CONTRACT_VERSION,
        context: state.context,
        project: scan.project,
        findings: scan.findings,
      };
      const res = await api.match(requestBody);
      gaps = res.gaps;
    }

    const result = { ...scan, gaps, context: state.context };
    state.last_scan = result;
    await saveState(stateDir, state);

    const summary = summarizeFindings(result.findings);
    if (summary.fail === 0 && summary.warning === 0) {
      spinner.succeed("Scan complete: compliant (all local checks passed).");
    } else if (gaps.length > 0) {
      spinner.succeed(
        `Scan complete: ${summary.fail} fail, ${summary.warning} warning (${gaps.length} mapped gap(s)).`,
      );
    } else {
      spinner.succeed(`Scan complete: ${summary.fail} fail, ${summary.warning} warning.`);
    }

    if (opts.out) {
      const outPath = path.isAbsolute(opts.out) ? opts.out : path.join(cwd, opts.out);
      await fs.writeFile(outPath, JSON.stringify(result, null, 2) + "\n", "utf8");
    }

    if (!opts.json) {
      if (summary.fail === 0 && summary.warning === 0) {
        console.log("Compliant: no failing local governance controls detected.");
      } else {
        console.log(`Non-compliance: ${summary.fail} fail, ${summary.warning} warning.`);
        for (const f of summary.relevant) {
          console.log(`- ${f.control_id} (${f.severity}): ${f.status} — ${f.evidence_meta}`);
        }
      }

      if (gaps.length > 0) {
        console.log(`Mapped gaps: ${gaps.map((g) => g.gap_id).join(", ")}`);
        console.log("Next: run `statute fix`.");
      } else if (summary.fail === 0 && summary.warning === 0) {
        console.log("Next: run `statute fix` (optional).");
      } else {
        console.log("Next: sync a manifest (`statute init`) to enable gap IDs and remediations, or inspect failing controls above.");
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
