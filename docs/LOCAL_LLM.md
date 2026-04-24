# Local SLM/LLM Plug‑In (Preflight Auto‑Assessment)

`statute scan --preflight` is deterministic by default. You can optionally attach a **local** SLM/LLM to refine:
- `readiness_summary.detected_use_case`
- `compliance_prefill` (legal basis + minimization justification)

## Safety Defaults

- Default is **metadata-only**: the CLI sends a feature summary (keyword hits, counts, hashed identifiers), not raw code.
- Raw code sending is **off** by default and must be explicitly enabled.

## Enable via `.statute/llm.json`

Create `.statute/llm.json`:

```json
{
  "enabled": true,
  "provider": "openai_compat",
  "base_url": "http://127.0.0.1:1234",
  "model": "local-model",
  "allow_send_code": false
}
```

Supported providers:
- `openai_compat` (OpenAI-compatible local servers; uses `/v1/chat/completions`)
- `ollama` (default base URL `http://127.0.0.1:11434`)
- `lmstudio` (default base URL `http://127.0.0.1:1234`)

## Quick Setup (CLI)

```bash
npx statute-os llm init
```

## Run

```bash
npx statute-os scan --preflight --auto-assess --json
```

Override on the command line:

```bash
npx statute-os scan --preflight --auto-assess --llm-provider lmstudio --llm-url http://127.0.0.1:1234 --llm-model my-model
```

## Dangerous Option: Send Raw Code

```bash
npx statute-os scan --preflight --auto-assess --llm-send-code
```

This can leak secrets/PII to the model runtime. Prefer metadata-only.
