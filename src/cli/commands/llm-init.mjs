import path from "node:path";

import ora from "ora";
import inquirer from "inquirer";

import { resolveStateDir, loadState } from "../state.mjs";
import { ensureDir, writeJsonAtomic } from "../util/fs.mjs";

function defaultBaseUrl(provider) {
  if (provider === "ollama") return "http://127.0.0.1:11434";
  if (provider === "lmstudio") return "http://127.0.0.1:1234";
  return "http://127.0.0.1:8000";
}

function normalizeProvider(p) {
  const v = String(p ?? "").trim();
  if (!v) return null;
  return v;
}

export async function runLlmInit(opts) {
  const cwd = process.cwd();
  const stateDir = resolveStateDir(opts.config, cwd);
  const spinner = ora("Configuring local LLM...").start();

  try {
    await ensureDir(stateDir);
    const state = await loadState(stateDir);
    const existing = state?.llm ?? null;

    const providerFlag = normalizeProvider(opts.provider ?? opts.llmProvider);
    const modelFlag = opts.model ?? opts.llmModel ?? null;
    const urlFlag = opts.url ?? opts.llmUrl ?? null;
    const allowSendCodeFlag = opts.allowSendCode === true;

    /** @type {{provider: string, base_url: string, model: string, allow_send_code: boolean, enabled: boolean}} */
    let cfg = {
      enabled: true,
      provider: providerFlag ?? existing?.provider ?? "openai_compat",
      base_url: urlFlag ?? existing?.base_url ?? defaultBaseUrl(providerFlag ?? existing?.provider ?? "openai_compat"),
      model: modelFlag ?? existing?.model ?? "local-model",
      allow_send_code: allowSendCodeFlag || existing?.allow_send_code === true,
    };

    if (!opts.yes) {
      spinner.stop();
      const answers = await inquirer.prompt([
        {
          type: "list",
          name: "provider",
          message: "Local LLM provider",
          choices: [
            { name: "OpenAI-compatible server", value: "openai_compat" },
            { name: "Ollama", value: "ollama" },
            { name: "LM Studio", value: "lmstudio" },
            { name: "Mock (tests only)", value: "mock" },
          ],
          default: cfg.provider,
        },
        {
          type: "input",
          name: "base_url",
          message: "Base URL",
          default: (a) => defaultBaseUrl(a.provider),
        },
        {
          type: "input",
          name: "model",
          message: "Model name",
          default: cfg.model,
        },
        {
          type: "confirm",
          name: "allow_send_code",
          message: "Allow sending raw code to the model? (dangerous)",
          default: false,
        },
      ]);
      cfg = {
        ...cfg,
        provider: answers.provider,
        base_url: String(answers.base_url).trim(),
        model: String(answers.model).trim(),
        allow_send_code: answers.allow_send_code === true,
      };
      spinner.start();
    }

    const outPath = path.join(stateDir, "llm.json");
    await writeJsonAtomic(outPath, cfg);

    spinner.succeed(`LLM config written: ${path.relative(cwd, outPath)}`);
    if (opts.json) {
      console.log(JSON.stringify({ ok: true, path: outPath, llm: cfg }, null, 2));
    } else {
      console.log(`Next: run \`statute scan --preflight --auto-assess --json\``);
    }
  } catch (err) {
    spinner.fail("LLM init failed.");
    const msg = err instanceof Error ? err.message : String(err);
    if (opts.debug) console.error(err);
    else console.error(msg);
    process.exitCode = 1;
  }
}

