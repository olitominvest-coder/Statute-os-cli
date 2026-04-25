import path from "node:path";

import { readJson } from "../util/fs.mjs";
import { CreditsResponseSchema, ManifestSchema, MatchResponseSchema, TemplateSchema } from "../contracts.mjs";

export class StatuteApiClient {
  constructor({ apiUrl, token, debug, stateDir }) {
    this.apiUrl = apiUrl?.replace(/\/+$/, "") ?? null;
    this.token = token ?? null;
    this.debug = !!debug;
    this.stateDir = stateDir ?? null;
  }

  headers() {
    /** @type {Record<string, string>} */
    const h = { "content-type": "application/json" };
    if (this.token) h.authorization = `Bearer ${this.token}`;
    return h;
  }

  assertConfigured() {
    if (!this.apiUrl) throw new Error("STATUTE_API_URL_MISSING");
  }

  isMock() {
    return typeof this.apiUrl === "string" && this.apiUrl.startsWith("mock://");
  }

  mockRoot() {
    if (!this.stateDir) throw new Error("MOCK_API_REQUIRES_STATE_DIR");
    return path.join(this.stateDir, "mock-api");
  }

  async getCredits() {
    this.assertConfigured();
    if (this.isMock()) {
      const json = await readJson(path.join(this.mockRoot(), "credits.json"));
      return CreditsResponseSchema.parse(json);
    }

    // Prefer a CLI-specific credits endpoint when available; fall back to web endpoint.
    const candidates = [`${this.apiUrl}/cli/v1/credits`, `${this.apiUrl}/api/credits`];
    /** @type {any | null} */
    let lastErr = null;
    for (const u of candidates) {
      try {
        const res = await fetch(u, { headers: this.headers() });
        if (!res.ok) {
          if (res.status === 404) continue;
          throw new Error(`API_CREDITS_FAILED:${res.status}`);
        }
        const json = await res.json();
        return CreditsResponseSchema.parse(json);
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr ?? new Error("API_CREDITS_FAILED");
  }

  async assertHasScanCredits() {
    const c = await this.getCredits();
    const scanCredits = c?.credits?.scan_credits;
    // null => metered/unlimited/unknown; allow.
    if (scanCredits === 0) throw new Error("NO_CREDITS:SCAN");
  }

  async getManifest({ jurisdictions, riskTier }) {
    this.assertConfigured();
    if (this.isMock()) {
      const json = await readJson(path.join(this.mockRoot(), "manifest.json"));
      return ManifestSchema.parse(json);
    }
    const url = new URL(`${this.apiUrl}/cli/v1/manifest`);
    if (jurisdictions?.length) url.searchParams.set("jurisdictions", jurisdictions.join(","));
    if (riskTier) url.searchParams.set("risk_tier", riskTier);

    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) throw new Error(`API_MANIFEST_FAILED:${res.status}`);
    const json = await res.json();
    return ManifestSchema.parse(json);
  }

  async match(requestBody) {
    this.assertConfigured();
    if (this.isMock()) {
      const json = await readJson(path.join(this.mockRoot(), "match.json"));
      return MatchResponseSchema.parse(json);
    }
    const res = await fetch(`${this.apiUrl}/cli/v1/match`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(requestBody),
    });
    if (!res.ok) throw new Error(`API_MATCH_FAILED:${res.status}`);
    const json = await res.json();
    return MatchResponseSchema.parse(json);
  }

  async getTemplate(templateId) {
    this.assertConfigured();
    if (this.isMock()) {
      const json = await readJson(
        path.join(this.mockRoot(), "remediations", `${templateId}.json`),
      );
      return TemplateSchema.parse(json);
    }
    const res = await fetch(`${this.apiUrl}/cli/v1/remediations/${encodeURIComponent(templateId)}`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`API_TEMPLATE_FAILED:${res.status}`);
    const json = await res.json();
    return TemplateSchema.parse(json);
  }

  async listJurisdictions() {
    this.assertConfigured();
    if (this.isMock()) {
      const json = await readJson(path.join(this.mockRoot(), "jurisdictions.json"));
      return json;
    }
    const res = await fetch(`${this.apiUrl}/cli/v1/jurisdictions`, { headers: this.headers() });
    if (!res.ok) throw new Error(`API_JURISDICTIONS_FAILED:${res.status}`);
    return await res.json();
  }

  async getPack(jurisdictionCode) {
    this.assertConfigured();
    if (this.isMock()) {
      const json = await readJson(path.join(this.mockRoot(), "packs", `${jurisdictionCode}.json`));
      return json;
    }
    const res = await fetch(
      `${this.apiUrl}/cli/v1/packs/${encodeURIComponent(jurisdictionCode)}`,
      { headers: this.headers() },
    );
    if (!res.ok) throw new Error(`API_PACK_FAILED:${res.status}`);
    return await res.json();
  }

  async getAssessment(assessmentId) {
    this.assertConfigured();
    if (this.isMock()) {
      const json = await readJson(path.join(this.mockRoot(), "assessment.json"));
      return json;
    }
    const res = await fetch(`${this.apiUrl}/api/assessments/${encodeURIComponent(assessmentId)}`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`API_ASSESSMENT_FAILED:${res.status}`);
    return await res.json();
  }

  async listConnections() {
    this.assertConfigured();
    if (this.isMock()) {
      const json = await readJson(path.join(this.mockRoot(), "connections.json"));
      return json;
    }
    const res = await fetch(`${this.apiUrl}/api/connections`, { headers: this.headers() });
    if (!res.ok) throw new Error(`API_CONNECTIONS_FAILED:${res.status}`);
    return await res.json();
  }

  async triggerScan({ assessmentId, connectionId, runAll = true, scanTypes }) {
    this.assertConfigured();
    if (this.isMock()) {
      const json = await readJson(path.join(this.mockRoot(), "scan-trigger.json"));
      return json;
    }
    const body = {
      assessment_id: assessmentId,
      connection_id: connectionId,
      run_all: runAll,
      scan_types: scanTypes,
    };
    const res = await fetch(`${this.apiUrl}/api/scans`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`API_SCAN_TRIGGER_FAILED:${res.status}`);
    return await res.json();
  }

  async testConnection(connectionId) {
    this.assertConfigured();
    if (this.isMock()) {
      try {
        const json = await readJson(
          path.join(this.mockRoot(), "connection-tests", `${connectionId}.json`),
        );
        return json;
      } catch {
        return { ok: true, message: "mock ok", latency_ms: 1 };
      }
    }
    const res = await fetch(
      `${this.apiUrl}/api/connections/${encodeURIComponent(connectionId)}/test`,
      { method: "POST", headers: this.headers() },
    );
    if (!res.ok) throw new Error(`API_CONNECTION_TEST_FAILED:${res.status}`);
    return await res.json();
  }
}
