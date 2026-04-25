# Statute OS CLI (Public)

Public, distributable CLI portion of Statute OS (Governance-as-Code).

## Quickstart

- Local governance scan (prints non-compliance findings):
  - `npx statute-os scan --offline --profile auto`

- Preflight security diff (machine-readable JSON):
  - `npx statute-os --json scan --preflight --preflight-path . --profile data`
- `npx statute-os audit --fix`

## Docs

- `cli_cmd_list.md` — full command list (local + server)
- `docs/LOCAL_LLM.md` — plug in a local SLM/LLM for auto-assessment
