# Statute OS CLI — Command List (Local + Server)

This repo provides a Zero-Trust “Governance-as-Code” CLI.

## Global Options (all commands)

- `--api-url <url>` Statute OS API base URL (or `STATUTE_API_URL`)
- `--token <token>` Statute OS API token (or `STATUTE_API_TOKEN`)
- `--config <path>` State directory (default: `.statute`)
- `--assessment-id <uuid>` Bind this run to an assessment (prefills jurisdictions/risk tier when available)
- `--integration-key <key>` Integration profile key (used for `--server` scans)
- `--local` Force local-only mode (default unless `--server`)
- `--server` Trigger server-side scans (Databricks/Snowflake/AWS/GCP/Azure) before local audit
- `--json` JSON-only output (machine readable). Recommended placement: `statute --json <command> ...`
- `--debug` Verbose errors

## Local Workflow (recommended)

### `statute init`
Interactive setup: jurisdictions + risk tier (+ optional assessment id) and manifest sync.

- If `--assessment-id` is provided and `--api-url` is set, the CLI fetches assessment context from the server.

### `statute scan`
Local metadata audit of the repo, producing `findings` (and optionally `gaps`).

Notes:
- `findings` are the primary compliance signal in local-only mode.
- `gaps` require a manifest mapping (`statute init` with `--api-url`) or server matching; if you run fully offline without a cached manifest, `gaps` will be empty even when there are non-compliance findings.

Options:
- `--profile <profile>` One of `auto|agent|data|app` (affects which local controls run and how preflight is tuned)
- `--fail-on <severity>` Exit non-zero when non-compliance meets/exceeds `low|medium|high|critical` (or `none`)
- `--format <format>` `text|github` (GitHub Actions annotations; ignored when `--json` is set)
- `--offline` Don’t call the API (use cached manifest only)
- `--out <path>` Write scan JSON to file

### `statute scan --preflight`
Databricks Clean Room “Pre-Flight” scan that returns the strict JSON **Security Diff**.

Options:
- `--preflight` Enable preflight mode (required)
- `--auto-assess` Use a local SLM/LLM to refine `detected_use_case` + `compliance_prefill`
- `--llm-provider <provider>` `openai_compat|ollama|lmstudio|mock`
- `--llm-url <url>` Local LLM base URL (e.g. LM Studio: `http://127.0.0.1:1234`, Ollama: `http://127.0.0.1:11434`)
- `--llm-model <model>` Local model name
- `--llm-send-code` DANGEROUS: opt-in to send raw code to the local model (default off)
- `--preflight-path <path>` File or directory to scan (default: cwd)
- `--allowed-prefix <prefix>` Allowlisted egress prefix (repeatable). Example:
  - `--allowed-prefix dbfs:/Volumes/cleanroom/`
  - `--allowed-prefix abfss://approved-container@account.dfs.core.windows.net/cleanroom/`

Outputs:
- Writes last result to `.statute/last-preflight.json`
- With `--json`, prints the Security Diff JSON to stdout
- `security_diff[]` includes `file` and `file_line_number` when available, plus `table_refs` (best-effort hints; double-check in dynamic codebases)
See `docs/LOCAL_LLM.md` for local model setup.

### `statute jurisdictions list`
Lists jurisdiction codes available from the Statute OS server (requires `--api-url` + `--token`).

### `statute pack pull <jurisdiction>`
Downloads a jurisdiction “pack” (articles + control mappings) from the Statute OS server and caches it to `.statute/packs/<jurisdiction>.json`.

### `statute pack show <jurisdiction>`
Prints the cached pack JSON.

### `statute fix`
Applies a remediation template (AST-safe edits), with rollback + optional git branch, and post-fix audit.

Options:
- `--gap-id <id>` Gap to remediate (otherwise prompt)
- `--dry-run` Write patch file instead of modifying files
- `--patch-out <path>` Patch output path
- `--no-branch` Don’t create `statute/fix-<gap-id>` branch

### `statute audit`
Two-line workflow: runs `scan`, and optionally `fix`.

Options:
- `--fix` Apply remediation after scan
- plus all `scan` / `fix` options (e.g. `--gap-id`, `--dry-run`, `--offline`)

## Server Scanning Mode (Databricks / Snowflake / AWS / GCP / Azure)

Server mode triggers scans via the Statute OS API (no credentials returned to the CLI).

### `statute integrations link`
Creates/updates `.statute/integrations/<key>.json` with server connection IDs.

Interactive:
- `statute integrations link --assessment-id <uuid>`

Non-interactive:
- `statute integrations link --key prod --databricks <uuid> --snowflake <uuid> ...`

Options:
- `--test` Test selected connections via `POST /api/connections/<id>/test` before saving
- `--allow-failed` Allow saving even if a connection test fails (only relevant with `--test`)

### `statute audit --server`
Triggers server scans for platforms in the integration profile, then runs the local audit.

Example:
- `statute audit --server --integration-key prod --assessment-id <uuid> --api-url https://...`

Notes:
- `--assessment-id` is required for server mode.
- You can still run local remediation after server scans (add `--fix`).

## Local LLM Setup

### `statute llm init`
Creates/updates `.statute/llm.json` for local auto-assessment.

Examples:
- `statute llm init` (interactive)
- `statute llm init --provider ollama --url http://127.0.0.1:11434 --model llama3 --yes`
