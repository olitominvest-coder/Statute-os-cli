import path from "node:path";

import ora from "ora";
import inquirer from "inquirer";

import { resolveStateDir, loadState } from "../state.mjs";
import { ensureDir, writeJsonAtomic } from "../util/fs.mjs";
import { StatuteApiClient } from "../api/client.mjs";
import { PLATFORMS, resolveIntegrationProfilePath } from "../integrations.mjs";

function normalizeConnId(v) {
  if (!v) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function platformLabel(p) {
  if (p === "databricks") return "Databricks";
  if (p === "snowflake") return "Snowflake";
  if (p === "aws") return "AWS";
  if (p === "gcp") return "GCP";
  if (p === "azure") return "Azure";
  return p;
}

function buildFromFlags(opts) {
  /** @type {Record<string,string>} */
  const connections = {};
  for (const p of PLATFORMS) {
    const id = normalizeConnId(opts[p]);
    if (id) connections[p] = id;
  }
  return connections;
}

function shouldTestConnections({ hasAnyFlag, testFlag }) {
  // Interactive default: test unless user says --no-test.
  // Non-interactive default: do not test unless user says --test.
  if (hasAnyFlag) return testFlag === true;
  return testFlag !== false;
}

export async function runIntegrationsLink(opts) {
  const cwd = process.cwd();
  const stateDir = resolveStateDir(opts.config, cwd);
  const spinner = ora("Linking integrations...").start();

  try {
    const state = await loadState(stateDir);
    const apiUrl = opts.apiUrl ?? state.api_url ?? null;
    if (!apiUrl) throw new Error("STATUTE_API_URL_MISSING");

    const api = new StatuteApiClient({ apiUrl, token: opts.token, debug: opts.debug, stateDir });
    await api.assertHasScanCredits();

    const assessmentId = opts.assessmentId ?? state.context?.assessment_id ?? null;

    // Non-interactive path: all ids provided by flags.
    const fromFlags = buildFromFlags(opts);
    const hasAnyFlag = Object.keys(fromFlags).length > 0;
    const doTest = shouldTestConnections({ hasAnyFlag, testFlag: opts.test });

    let key = opts.key ?? null;
    if (!key && hasAnyFlag) throw new Error("INTEGRATION_KEY_REQUIRED");

    spinner.text = "Fetching available connections...";
    const res = await api.listConnections();
    const all = Array.isArray(res?.connections) ? res.connections : [];
    const scoped = assessmentId
      ? all.filter((c) => c?.assessment_id === assessmentId)
      : all;

    if (scoped.length === 0) {
      throw new Error(
        assessmentId
          ? `NO_CONNECTIONS_FOR_ASSESSMENT:${assessmentId}`
          : "NO_CONNECTIONS_FOUND",
      );
    }

    /** @type {Record<string,string>} */
    let chosen = fromFlags;

    if (!hasAnyFlag) {
      spinner.stop();
      const answers = await inquirer.prompt([
        {
          type: "input",
          name: "key",
          message: "Integration profile key (e.g. prod)",
          default: key ?? "prod",
          validate: (v) => (String(v).trim().length ? true : "Key is required."),
        },
      ]);
      key = String(answers.key).trim();

      /** @type {Record<string,string>} */
      const selected = {};
      for (const p of PLATFORMS) {
        const options = scoped.filter((c) => c?.platform === p);
        if (options.length === 0) continue;
        // eslint-disable-next-line no-await-in-loop
        const { conn } = await inquirer.prompt([
          {
            type: "list",
            name: "conn",
            message: `${platformLabel(p)} connection to use (Assessment: ${assessmentId ?? "any"})`,
            choices: [
              { name: "Skip", value: "" },
              ...options.map((c) => ({
                name: `${c.display_name ?? c.id}  (${c.region ?? "n/a"})`,
                value: c.id,
              })),
            ],
          },
        ]);
        if (conn) {
          if (doTest) {
            const tSpin = ora(`Testing ${platformLabel(p)} connection...`).start();
            try {
              // eslint-disable-next-line no-await-in-loop
              const result = await api.testConnection(conn);
              if (result?.ok) {
                tSpin.succeed(`✅ ${platformLabel(p)} OK (${result.latency_ms ?? "?"}ms)`);
                selected[p] = conn;
              } else {
                tSpin.fail(`❌ ${platformLabel(p)} failed: ${result?.message ?? "unknown"}`);
                // eslint-disable-next-line no-await-in-loop
                const { useAnyway } = await inquirer.prompt([
                  {
                    type: "confirm",
                    name: "useAnyway",
                    message: "Use this connection anyway?",
                    default: false,
                  },
                ]);
                if (useAnyway) selected[p] = conn;
              }
            } catch (e) {
              tSpin.fail(`❌ ${platformLabel(p)} test error`);
              if (opts.debug) console.error(e);
              // eslint-disable-next-line no-await-in-loop
              const { useAnyway } = await inquirer.prompt([
                {
                  type: "confirm",
                  name: "useAnyway",
                  message: "Use this connection anyway?",
                  default: false,
                },
              ]);
              if (useAnyway) selected[p] = conn;
            }
          } else {
            selected[p] = conn;
          }
        }
      }
      chosen = selected;
      spinner.start();
    } else {
      // Validate flag-provided IDs exist and match platform (and assessment scope if provided).
      for (const [p, id] of Object.entries(chosen)) {
        const found = scoped.find((c) => c?.id === id);
        if (!found) throw new Error(`CONNECTION_NOT_FOUND_OR_NOT_IN_SCOPE:${p}:${id}`);
        if (found.platform !== p) throw new Error(`CONNECTION_PLATFORM_MISMATCH:${p}:${id}`);
      }
    }

    if (!key) throw new Error("INTEGRATION_KEY_REQUIRED");
    if (Object.keys(chosen).length === 0) throw new Error("NO_CONNECTIONS_SELECTED");

    if (doTest && hasAnyFlag) {
      for (const [p, id] of Object.entries(chosen)) {
        // eslint-disable-next-line no-await-in-loop
        const result = await api.testConnection(id);
        if (!result?.ok && !opts.allowFailed) {
          throw new Error(`CONNECTION_TEST_FAILED:${p}:${result?.message ?? "unknown"}`);
        }
      }
    }

    const outPath = resolveIntegrationProfilePath(stateDir, key);
    await ensureDir(path.dirname(outPath));
    await writeJsonAtomic(outPath, {
      schema_version: "cli_integrations_v1",
      updated_at: new Date().toISOString(),
      assessment_id: assessmentId ?? undefined,
      server: { connections: chosen },
    });

    spinner.succeed(`Integration profile saved: ${path.relative(cwd, outPath)}`);
    if (opts.json) {
      console.log(JSON.stringify({ ok: true, key, path: outPath, connections: chosen }, null, 2));
    }
  } catch (err) {
    spinner.fail("Integrations link failed.");
    const msg = err instanceof Error ? err.message : String(err);
    if (opts.debug) console.error(err);
    else console.error(msg);
    process.exitCode = 1;
  }
}
