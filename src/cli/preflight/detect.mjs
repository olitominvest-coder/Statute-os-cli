function lc(s) {
  return String(s ?? "").toLowerCase();
}

function includesAny(haystack, needles) {
  const h = lc(haystack);
  return needles.some((n) => h.includes(lc(n)));
}

function piiMentions(line, piiColumns) {
  const h = lc(line);
  return piiColumns.filter((c) => {
    const t = lc(c);
    // word-ish match: column name boundaries
    return new RegExp(`\\b${t.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`, "i").test(h);
  });
}

function isTransformed(line, safeTransforms) {
  const h = lc(line);
  return safeTransforms.some((t) => h.includes(`${lc(t)}(`));
}

function looksLikeSqlSelect(line) {
  const h = lc(line).trim();
  return h.startsWith("select ") || h.includes(" select ");
}

function looksLikeSqlJoin(line) {
  const h = lc(line);
  return h.includes(" join ") && h.includes(" on ");
}

function looksLikePySparkJoin(line) {
  const h = lc(line);
  return h.includes(".join(");
}

function looksLikeEgressWrite(line) {
  const h = lc(line);
  return (
    h.includes("dbutils.fs.cp(") ||
    h.includes("dbutils.fs.put(") ||
    h.includes("dbutils.fs.mount(") ||
    h.includes(".write.") ||
    h.includes(".save(") ||
    h.includes(".saveastable(")
  );
}

function extractQuotedPaths(line) {
  const out = [];
  const re = /['"]([^'"]{3,})['"]/g;
  let m;
  while ((m = re.exec(String(line))) !== null) {
    out.push(m[1]);
  }
  return out;
}

function pathAllowed(pathStr, allowedPrefixes) {
  if (!pathStr) return true;
  if (!allowedPrefixes || allowedPrefixes.length === 0) return false;
  return allowedPrefixes.some((p) => pathStr.startsWith(p));
}

function isExternalEgressPath(p) {
  const s = String(p ?? "");
  return (
    s.startsWith("s3://") ||
    s.startsWith("gs://") ||
    s.startsWith("abfss://") ||
    s.startsWith("adl://") ||
    s.startsWith("wasbs://") ||
    s.startsWith("https://") ||
    s.startsWith("http://")
  );
}

function severityRank(sev) {
  return sev === "CRITICAL" ? 3 : sev === "MEDIUM" ? 2 : 1;
}

export function detectSecurityDiff({ records, config, allowedPrefixes }) {
  const diff = [];
  const piiCols = config.pii_columns ?? [];

  for (const r of records) {
    const line = r.code ?? "";
    const pii = piiMentions(line, piiCols);

    // 1) PII leakage: raw select without transform
    if (pii.length > 0) {
      const safe = isTransformed(line, config.safe_transforms_sql ?? []) || isTransformed(line, config.safe_transforms_pyspark ?? []);
      if (looksLikeSqlSelect(line) && !safe) {
        diff.push({
          line_number: r.line_number,
          code_snippet: line.trim().slice(0, 240),
          severity: "CRITICAL",
          violation_type: "PII Leakage",
          remediation: `Replace raw PII column(s) (${pii.join(", ")}) with masking or salted hash (e.g., sha2(concat(lit(SALT), col), 256)).`,
        });
      }

      // PySpark raw select / withColumn passthrough heuristics
      const h = lc(line);
      if (
        (h.includes(".select(") || h.includes("withcolumn(")) &&
        !safe
      ) {
        diff.push({
          line_number: r.line_number,
          code_snippet: line.trim().slice(0, 240),
          severity: "MEDIUM",
          violation_type: "PII Leakage",
          remediation: `Avoid selecting raw PII (${pii.join(", ")}). Apply sha2/hash/mask before select/export.`,
        });
      }
    }

    // 2) Egress violations: display/collect/toPandas + external calls
    if (includesAny(line, config.egress_blocklist_tokens ?? [])) {
      const sev = pii.length > 0 ? "CRITICAL" : "MEDIUM";
      diff.push({
        line_number: r.line_number,
        code_snippet: line.trim().slice(0, 240),
        severity: sev,
        violation_type: "Egress",
        remediation: "Remove or gate egress. In clean rooms, avoid display/collect/toPandas and external HTTP calls; write only to approved boundary paths.",
      });
    }

    // 3) Egress writes to unapproved paths
    if (looksLikeEgressWrite(line)) {
      const paths = extractQuotedPaths(line);
      const bad = paths.find((p) => isExternalEgressPath(p) && !pathAllowed(p, allowedPrefixes));
      if (bad) {
        diff.push({
          line_number: r.line_number,
          code_snippet: line.trim().slice(0, 240),
          severity: "CRITICAL",
          violation_type: "Egress",
          remediation: `Write only to approved clean-room boundary paths. Current path "${bad}" is not allowlisted.`,
        });
      }
    }

    // 4) Joins on raw PII
    if (pii.length > 0 && (looksLikeSqlJoin(line) || looksLikePySparkJoin(line))) {
      const h = lc(line);
      if (h.includes("=") || h.includes("on=") || h.includes(" on=") || h.includes(" on ")) {
        diff.push({
          line_number: r.line_number,
          code_snippet: line.trim().slice(0, 240),
          severity: "CRITICAL",
          violation_type: "Logic",
          remediation: `Do not join on raw PII (${pii.join(", ")}). Join on salted hash keys (e.g., email_hash) instead.`,
        });
      }
    }

    // 5) Secrets usage & hardcoded creds
    if (includesAny(line, config.secrets_tokens ?? [])) {
      diff.push({
        line_number: r.line_number,
        code_snippet: line.trim().slice(0, 240),
        severity: "MEDIUM",
        violation_type: "Logic",
        remediation: "Local simulation should not depend on dbutils.secrets. Use env var stubs locally; rely on server-run secrets for production scans.",
      });
    }

    for (const p of config.cred_patterns ?? []) {
      try {
        const re = new RegExp(p.re);
        if (re.test(String(line))) {
          diff.push({
            line_number: r.line_number,
            code_snippet: line.trim().slice(0, 240),
            severity: "CRITICAL",
            violation_type: "Logic",
            remediation: "Remove hardcoded credentials. Use secret managers / server-side connections; never commit secrets into notebooks/scripts.",
          });
          break;
        }
      } catch {
        // ignore invalid regex
      }
    }
  }

  // Deduplicate same line+type, keep highest severity
  const byKey = new Map();
  for (const d of diff) {
    const key = `${d.line_number}:${d.violation_type}:${d.code_snippet}`;
    const prev = byKey.get(key);
    if (!prev || severityRank(d.severity) > severityRank(prev.severity)) byKey.set(key, d);
  }

  return Array.from(byKey.values()).sort((a, b) => a.line_number - b.line_number);
}
