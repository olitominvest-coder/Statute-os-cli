import ora from "ora";
import { resolveStateDir, loadState } from "../state.mjs";
import { StatuteApiClient } from "../api/client.mjs";

const SEVERITY_COLOR = {
  critical: "\x1b[31m", // red
  high:     "\x1b[33m", // yellow
  medium:   "\x1b[36m", // cyan
  low:      "\x1b[90m", // grey
};
const RESET = "\x1b[0m";
const BOLD  = "\x1b[1m";
const DIM   = "\x1b[2m";

function colorSeverity(sev) {
  return `${SEVERITY_COLOR[sev] ?? ""}${sev?.toUpperCase() ?? ""}${RESET}`;
}

export async function runExplain(opts) {
  const cwd = process.cwd();
  const stateDir = resolveStateDir(opts.config, cwd);
  const spinner = ora("Fetching explanation…").start();

  try {
    const gapId = opts.gapId;
    if (!gapId) {
      spinner.fail("Gap ID required. Usage: statute explain <gap-id>");
      process.exitCode = 1;
      return;
    }

    const state = await loadState(stateDir);
    const apiUrl = opts.apiUrl ?? state.api_url;
    if (!apiUrl) {
      spinner.fail("STATUTE_API_URL not set. Run `statute init` first or pass --api-url.");
      process.exitCode = 1;
      return;
    }

    const api = new StatuteApiClient({
      apiUrl,
      token: opts.token,
      debug: opts.debug,
      stateDir,
    });

    const result = await api.explainGap(gapId);
    spinner.stop();

    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    // Pretty terminal output
    const sev = result.severity ? colorSeverity(result.severity) : "";
    const law = result.law_name ? `${DIM}${result.law_name}${RESET}` : "";
    const art = result.article_ref ? `${DIM}${result.article_ref}${RESET}` : "";

    console.log();
    console.log(`${BOLD}── Gap: ${result.gap_id} ${sev} ${law} ${art}${RESET}`);
    console.log();

    console.log(`${BOLD}What it means${RESET}`);
    console.log(`  ${result.plain_english}`);
    console.log();

    console.log(`${BOLD}Why it matters${RESET}`);
    console.log(`  ${result.why_it_matters}`);
    console.log();

    if (result.incident_example) {
      console.log(`${BOLD}Real-world incident${RESET}`);
      console.log(`  ${result.incident_example}`);
      console.log();
    }

    if (result.regulatory_refs?.length) {
      console.log(`${BOLD}Regulatory references${RESET}`);
      for (const ref of result.regulatory_refs) {
        console.log(`  ${BOLD}${ref.law}${RESET} ${ref.article}`);
        if (ref.consequence) console.log(`    ${DIM}→ ${ref.consequence}${RESET}`);
      }
      console.log();
    }

    if (result.remediation_steps?.length) {
      console.log(`${BOLD}Remediation steps${RESET}`);
      result.remediation_steps.forEach((step, i) => {
        console.log(`  ${i + 1}. ${step}`);
      });
      console.log();
    }

    console.log(`${DIM}Run \`statute fix --gap-id ${result.gap_id}\` to apply an AST-safe codemod.${RESET}`);
    console.log();

  } catch (err) {
    spinner.fail("Explain failed.");
    const msg = err instanceof Error ? err.message : String(err);
    if (opts.debug) {
      console.error(err);
    } else {
      console.error(msg);
    }
    process.exitCode = 1;
  }
}
