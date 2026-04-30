# Statute OS CLI

Governance-as-Code checks you can run locally, in CI, or alongside Statute OS server scans.

This repo contains the public, distributable CLI portion of Statute OS.

## What this does

- Scans a repo’s code + config + infra files and produces **findings** (pass/warn/fail) and, when available, matched **gaps**.
- Runs fully **offline** (no API calls) using cached manifests under `.statute/`.
- Emits **machine-readable JSON** for CI pipelines (`--json`) and can **fail builds** at a chosen severity (`--fail-on`).
- Includes a Databricks Clean Room **preflight** mode that outputs a strict JSON **Security Diff**.
- Can apply **AST-safe remediations** with `statute-os fix` / `statute-os audit --fix`.

> Note: This project helps you operationalize governance checks; it’s not legal advice.

## Quickstart

Run a local scan (offline):

```bash
npx --yes statute-os scan --offline --profile auto
```

Fail CI on high+ severity non-compliance:

```bash
npx --yes statute-os scan --fail-on high
```

Preflight (machine-readable JSON Security Diff):

```bash
npx --yes statute-os --json scan --preflight --preflight-path . --profile data
```

Audit and apply fixes:

```bash
npx --yes statute-os audit --fix
```

## Install

Prereqs: Node.js `>=20`.

- Recommended (no install): `npx --yes statute-os <command>`
- Optional (global): `npm i -g statute-os` then run `statute <command>` or `statute-os <command>`

## Documentation

- `cli_cmd_list.md` — full command list (local + server), options, and workflows
- `docs/LOCAL_LLM.md` — optional local SLM/LLM plug-in for preflight auto-assessment

## GitHub Action

This repo ships a composite GitHub Action (`action.yml`) you can use to scan PRs.

Example workflow step:

```yaml
- name: Statute OS scan
  uses: olitominvest-coder/Statute-os-cli@<tag>
  with:
    token: ${{ secrets.STATUTE_API_TOKEN }}
    assessment-id: ${{ vars.STATUTE_ASSESSMENT_ID }}
    fail-on: high
```

Offline-only (no token required):

```yaml
- name: Statute OS scan (offline)
  uses: olitominvest-coder/Statute-os-cli@<tag>
  with:
    offline: "true"
    fail-on: high
```

## Contributing

PRs and issues are welcome.

- See `CONTRIBUTING.md` for dev setup and guidelines.
- Please follow `CODE_OF_CONDUCT.md`.
- For help/troubleshooting, see `SUPPORT.md`.

## Security

If you believe you’ve found a security issue, follow `SECURITY.md`.
