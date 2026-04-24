import { sha256Hex } from "../util/hash.mjs";

function lc(s) {
  return String(s ?? "").toLowerCase();
}

function tokenize(text) {
  return lc(text)
    .replace(/[^a-z0-9_ .:/-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function countMatches(tokens, keywords) {
  const set = new Set(tokens);
  return keywords.reduce((acc, k) => acc + (set.has(lc(k)) ? 1 : 0), 0);
}

export function buildPreflightFeatureSummary({ records, securityDiff }) {
  const text = records.map((r) => r.code).join("\n");
  const tokens = tokenize(text);

  const keywords = [
    "fraud",
    "marketing",
    "attribution",
    "campaign",
    "patient",
    "diagnosis",
    "credit",
    "loan",
    "hiring",
    "candidate",
    "biometric",
    "kyc",
    "dsar",
    "gdpr",
    "ccpa",
  ];

  // Hash any dotted identifiers that look like tables (metadata-only).
  const dotted = Array.from(new Set((text.match(/\b[a-zA-Z_][\w]*\.[a-zA-Z_][\w]*\b/g) ?? [])));
  const tableHashes = dotted.slice(0, 50).map((t) => sha256Hex(t));

  const byType = {
    pii: securityDiff.filter((d) => d.violation_type === "PII Leakage").length,
    egress: securityDiff.filter((d) => d.violation_type === "Egress").length,
    logic: securityDiff.filter((d) => d.violation_type === "Logic").length,
    critical: securityDiff.filter((d) => d.severity === "CRITICAL").length,
  };

  return {
    keywords: keywords.filter((k) => tokens.includes(k)),
    keyword_score: countMatches(tokens, keywords),
    table_hashes: tableHashes,
    diff_counts: byType,
    ops: {
      select: (text.match(/\bselect\b/gi) ?? []).length,
      join: (text.match(/\bjoin\b/gi) ?? []).length,
      display: (text.match(/\bdisplay\s*\(/gi) ?? []).length,
      collect: (text.match(/\.collect\s*\(/gi) ?? []).length,
      toPandas: (text.match(/toPandas\s*\(/gi) ?? []).length,
      write: (text.match(/\.write\./gi) ?? []).length,
      secrets: (text.match(/dbutils\.secrets\.get/gi) ?? []).length,
      http: (text.match(/\bhttps?:\/\//gi) ?? []).length,
    },
  };
}

