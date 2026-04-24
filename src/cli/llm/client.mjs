import path from "node:path";

import { readJson } from "../util/fs.mjs";
import { AutoAssessResultSchema } from "./schema.mjs";

function resolveProviderBaseUrl(cfg) {
  if (cfg.provider === "ollama") return cfg.base_url ?? "http://127.0.0.1:11434";
  if (cfg.provider === "lmstudio") return cfg.base_url ?? "http://127.0.0.1:1234";
  return cfg.base_url ?? "http://127.0.0.1:8000";
}

function headers(cfg) {
  /** @type {Record<string,string>} */
  const h = { "content-type": "application/json" };
  const key = cfg.api_key ?? process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY ?? null;
  if (key) h.authorization = `Bearer ${key}`;
  return h;
}

function buildSystemPrompt(overrideText) {
  if (overrideText && overrideText.trim().length) return overrideText;
  return [
    "You are the Statute OS Pre-Flight Engine (Auto-Assessment add-on).",
    "Return ONLY valid JSON (no prose).",
    "You will be given a metadata-only feature summary of a Databricks notebook / SQL script.",
    "Infer detected_use_case and compliance_prefill conservatively.",
    "If uncertain, use 'Review Required' and keep justification short and technical.",
    "",
    "JSON schema:",
    "{",
    '  "detected_use_case": "string",',
    '  "compliance_prefill": {',
    '    "legal_basis": "string",',
    '    "data_minimization_check": true,',
    '    "justification": "string"',
    "  }",
    "}",
  ].join("\n");
}

export class LocalLlmClient {
  constructor({ cfg, stateDir, systemPromptOverride }) {
    this.cfg = cfg;
    this.stateDir = stateDir;
    this.systemPromptOverride = systemPromptOverride ?? null;
  }

  async autoAssess({ featureSummary, rawCode }) {
    if (this.cfg.provider === "mock") {
      const json = await readJson(path.join(this.stateDir, "mock-llm", "response.json"));
      return AutoAssessResultSchema.parse(json);
    }

    const base = resolveProviderBaseUrl(this.cfg).replace(/\/+$/, "");
    const url = `${base}/v1/chat/completions`;

    const system = buildSystemPrompt(this.systemPromptOverride);

    const userPayload =
      this.cfg.allow_send_code && rawCode
        ? {
            mode: "raw_code",
            code: rawCode,
            note: "If code contains secrets/PII, respond with Review Required and state why.",
          }
        : { mode: "metadata_only", feature_summary: featureSummary };

    const body = {
      model: this.cfg.model ?? "local-model",
      temperature: 0,
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: `Auto-assess this preflight summary and return JSON only:\n${JSON.stringify(userPayload)}`,
        },
      ],
    };

    const res = await fetch(url, { method: "POST", headers: headers(this.cfg), body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`LLM_FAILED:${res.status}`);
    const json = await res.json();

    const content =
      json?.choices?.[0]?.message?.content ??
      json?.choices?.[0]?.text ??
      null;
    if (typeof content !== "string" || !content.trim()) throw new Error("LLM_EMPTY");

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      // Some servers wrap in code fences; strip common patterns.
      const cleaned = content.replace(/```json\s*/i, "").replace(/```/g, "").trim();
      parsed = JSON.parse(cleaned);
    }

    return AutoAssessResultSchema.parse(parsed);
  }
}

