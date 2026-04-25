#!/usr/bin/env node
import { Command } from "commander";
import process from "node:process";

import { runInit } from "../src/cli/commands/init.mjs";
import { runScan } from "../src/cli/commands/scan.mjs";
import { runFix } from "../src/cli/commands/fix.mjs";
import { runAudit } from "../src/cli/commands/audit.mjs";
import { runIntegrationsLink } from "../src/cli/commands/integrations-link.mjs";
import { runLlmInit } from "../src/cli/commands/llm-init.mjs";
import { runJurisdictionsList } from "../src/cli/commands/jurisdictions.mjs";
import { runPackPull, runPackShow } from "../src/cli/commands/pack.mjs";

const program = new Command();

program
  .name("statute")
  .description("Statute OS — Governance-as-Code CLI (Zero-Trust)")
  .option("--api-url <url>", "Statute OS API base URL", process.env.STATUTE_API_URL)
  .option("--token <token>", "Statute OS API token", process.env.STATUTE_API_TOKEN)
  .option("--config <path>", "Path to .statute config directory", ".statute")
  .option("--assessment-id <id>", "Assessment ID (UUID) to bind this run")
  .option("--integration-key <key>", "Integration profile key (databricks/snowflake/aws/gcp/azure)")
  .option("--local", "Use local integration profiles (no server-side scans)", false)
  .option("--server", "Trigger server-side scans via Statute OS API", false)
  .option("--json", "Machine-readable JSON output", false)
  .option("--debug", "Verbose debug output", false);

program
  .command("init")
  .description("Sync assessment context (jurisdictions / risk tier) and manifest")
  .option("--jurisdictions <list>", "Comma-separated jurisdictions (e.g. EU,GDPR)")
  .option("--risk-tier <tier>", "Risk tier (low|medium|high)")
  .action(async (opts) => runInit({ ...program.opts(), ...opts }));

program
  .command("scan")
  .description("Local metadata audit of code, config, and infrastructure files")
  .option("--profile <profile>", "Scan profile: auto|agent|data|app", "auto")
  .option(
    "--format <format>",
    "Output format: text|github (ignored when --json is set)",
    "text",
  )
  .option(
    "--fail-on <severity>",
    "Exit non-zero when non-compliance at/above: none|low|medium|high|critical",
    "none",
  )
  .option(
    "--preflight",
    "Run Databricks Clean Room pre-flight scan (Security Diff JSON)",
    false,
  )
  .option(
    "--auto-assess",
    "Use a local SLM/LLM to refine detected_use_case + compliance_prefill (metadata-only by default)",
    false,
  )
  .option("--llm-provider <provider>", "Local LLM provider: openai_compat|ollama|lmstudio|mock")
  .option("--llm-url <url>", "Local LLM base URL (e.g. http://127.0.0.1:11434)")
  .option("--llm-model <model>", "Local LLM model name")
  .option("--llm-key <key>", "LLM API key (optional; env also supported)")
  .option(
    "--llm-send-code",
    "DANGEROUS: allow sending raw code to the LLM (default off; metadata-only is safer)",
    false,
  )
  .option(
    "--preflight-path <path>",
    "File or directory to scan for preflight (default: cwd)",
  )
  .option(
    "--allowed-prefix <prefix>",
    "Allowed egress path prefix for clean room (repeatable)",
    (v, acc) => {
      acc.push(v);
      return acc;
    },
    [],
  )
  .option("--offline", "Do not call the API (use cached manifest only)", false)
  .option("--out <path>", "Write scan results JSON to a file")
  .action(async (opts) => runScan({ ...program.opts(), ...opts }));

program
  .command("audit")
  .description("Two-line workflow: scan (and optionally fix) with post-fix audit")
  .option("--fix", "Automatically remediate matched gaps", false)
  .option("--gap-id <id>", "Gap ID to remediate (when --fix)")
  .option("--dry-run", "Generate a .patch file and do not modify files", false)
  .option("--offline", "Do not call the API (use cached manifest only)", false)
  .option("--no-branch", "Do not create a new git branch")
  .action(async (opts) => runAudit({ ...program.opts(), ...opts }));

const integrations = program
  .command("integrations")
  .description("Manage integration profiles for server-mode scans");

integrations
  .command("link")
  .description("Create or update an integration profile (.statute/integrations/<key>.json)")
  .option("--key <key>", "Integration profile key (e.g. prod)")
  .option("--databricks <id>", "Databricks connection id (UUID)")
  .option("--snowflake <id>", "Snowflake connection id (UUID)")
  .option("--aws <id>", "AWS connection id (UUID)")
  .option("--gcp <id>", "GCP connection id (UUID)")
  .option("--azure <id>", "Azure connection id (UUID)")
  .option("--test", "Test selected connections via API before saving")
  .option("--allow-failed", "Allow saving even if a connection test fails", false)
  .action(async (opts) => runIntegrationsLink({ ...program.opts(), ...opts }));

const llm = program
  .command("llm")
  .description("Configure a local SLM/LLM provider for auto-assessment");

llm
  .command("init")
  .description("Create or update .statute/llm.json")
  .option("--provider <provider>", "openai_compat|ollama|lmstudio|mock")
  .option("--url <url>", "Local LLM base URL (e.g. http://127.0.0.1:11434)")
  .option("--model <model>", "Model name")
  .option("--allow-send-code", "DANGEROUS: allow sending raw code to the LLM", false)
  .option("--yes", "Non-interactive: accept provided flags and defaults", false)
  .action(async (opts) => runLlmInit({ ...program.opts(), ...opts }));

program
  .command("fix")
  .description("Apply a remediation template using AST-safe edits")
  .option("--gap-id <id>", "Gap ID to remediate")
  .option("--dry-run", "Generate a .patch file and do not modify files", false)
  .option("--no-branch", "Do not create a new git branch")
  .option("--patch-out <path>", "Path for generated patch file")
  .action(async (opts) => runFix({ ...program.opts(), ...opts }));

const jurisdictions = program
  .command("jurisdictions")
  .description("List jurisdictions available from Statute OS");

jurisdictions
  .command("list")
  .description("List jurisdictions (requires --api-url and --token)")
  .action(async (opts) => runJurisdictionsList({ ...program.opts(), ...opts }));

const pack = program
  .command("pack")
  .description("Manage cached jurisdiction packs (.statute/packs/)");

pack
  .command("pull")
  .description("Download a jurisdiction pack and cache it locally")
  .argument("<jurisdiction>", "Jurisdiction code (e.g. EU_AI_ACT, GDPR)")
  .action(async (jurisdiction, opts) =>
    runPackPull({ ...program.opts(), ...opts, jurisdiction }),
  );

pack
  .command("show")
  .description("Print a cached jurisdiction pack from .statute/packs/")
  .argument("<jurisdiction>", "Jurisdiction code (e.g. EU_AI_ACT, GDPR)")
  .action(async (jurisdiction, opts) =>
    runPackShow({ ...program.opts(), ...opts, jurisdiction }),
  );

program.on("command:*", () => {
  program.help({ error: true });
});

await program.parseAsync(process.argv);
