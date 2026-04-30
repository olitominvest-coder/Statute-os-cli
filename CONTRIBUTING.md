# Contributing

Thanks for helping improve Statute OS CLI.

## Quick start (dev)

Prereqs: Node.js `>=20` and npm.

```bash
npm ci
npm test
```

Optional sanity checks:

```bash
npm run lint
node bin/statute.mjs --help
```

## Project layout

- `bin/statute.mjs` — CLI entrypoint (published as `statute` and `statute-os`)
- `src/` — implementation (local scanning, state, integrations, contracts)
- `docs/` — feature docs (e.g. local LLM plug-in)
- `cli_cmd_list.md` — canonical command list + examples

## Filing issues

- Bugs: include your OS, Node version, the exact command, and (if possible) `--debug` output.
- Feature requests: describe the workflow you want to enable and the expected output (text vs `--json`).

## Pull requests

- Keep PRs focused (one change/theme per PR).
- Update docs when behavior changes:
  - `README.md` for user-facing workflows
  - `cli_cmd_list.md` for flags/commands
  - `docs/*` for deeper guides
- Add/adjust tests under `test/` when practical.

## Code style

- This repo is ESM (`"type": "module"`).
- Prefer small, explicit functions and clear option names.

