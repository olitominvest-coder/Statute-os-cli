const RANK = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export function severityRank(value) {
  const v = String(value ?? "").toLowerCase();
  if (v in RANK) return RANK[v];
  return 0;
}

export function normalizeScanSeverity(severity) {
  const v = String(severity ?? "").toLowerCase();
  if (v === "critical" || v === "high" || v === "medium" || v === "low") return v;
  return "low";
}

export function normalizePreflightSeverity(severity) {
  const v = String(severity ?? "").toUpperCase();
  if (v === "CRITICAL") return "critical";
  if (v === "MEDIUM") return "medium";
  if (v === "LOW") return "low";
  return "low";
}

export function parseFailOn(value) {
  const v = String(value ?? "").toLowerCase();
  if (v === "none" || v === "low" || v === "medium" || v === "high" || v === "critical") return v;
  return "none";
}

export function shouldFail({ worstSeverity, failOn }) {
  const threshold = severityRank(parseFailOn(failOn));
  if (threshold <= 0) return false;
  return severityRank(worstSeverity) >= threshold;
}

