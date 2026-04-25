function lc(s) {
  return String(s ?? "").toLowerCase();
}

function normalizeIdentifier(s) {
  const t = String(s ?? "").trim();
  if (!t) return "";
  // Strip common quoting forms.
  return t.replace(/^["'`[]+/, "").replace(/["'`\]]+$/, "");
}

function isLikelyIdentifier(s) {
  const t = normalizeIdentifier(s);
  if (!t) return false;
  if (t.startsWith("(")) return false; // subquery
  // Allow db.schema.table, schema.table, table, with underscores/digits/$.
  return /^[A-Za-z_][\w$]*(\.[A-Za-z_][\w$]*){0,2}$/.test(t);
}

function extractSqlTableRefs(line) {
  const out = [];
  const text = String(line ?? "");
  // Very small SQL-ish extractor: FROM/JOIN <ident>
  const re = /\b(from|join)\s+([A-Za-z_][\w$]*)(?:\s*\.\s*([A-Za-z_][\w$]*))?(?:\s*\.\s*([A-Za-z_][\w$]*))?/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const kw = lc(m[1]);
    const parts = [m[2], m[3], m[4]].filter(Boolean);
    const name = parts.join(".");
    if (!isLikelyIdentifier(name)) continue;
    out.push({ name, kind: kw === "from" ? "from" : "join", confidence: "high" });
  }
  return out;
}

function extractSparkTableCalls(line) {
  const out = [];
  const text = String(line ?? "");
  const re = /\.(table|saveAsTable)\(\s*(['"])([^'"\\\n]{1,256})\2\s*\)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const fn = m[1];
    const name = normalizeIdentifier(m[3]);
    if (!isLikelyIdentifier(name)) continue;
    out.push({ name, kind: "table_call", confidence: "high" });
  }
  return out;
}

function extractSparkSqlLiteralTables(line) {
  const out = [];
  const text = String(line ?? "");
  const re = /\bspark\.sql\(\s*(['"])([^'"\\\n]{1,800})\1\s*\)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const sql = m[2];
    const refs = extractSqlTableRefs(sql).map((r) => ({ ...r, kind: "spark_sql_literal", confidence: "medium" }));
    out.push(...refs);
  }
  return out;
}

function mergeTableRefs(...lists) {
  const out = [];
  const seen = new Set();
  for (const list of lists) {
    for (const r of list ?? []) {
      const key = `${r.kind}:${r.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(r);
    }
  }
  return out.length ? out : undefined;
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
    const file = r.file;
    const fileLine = r.file_line_number;
    const isSqlFile = typeof file === "string" && file.toLowerCase().endsWith(".sql");
    // Avoid false positives (e.g., Python `from x import y`) by only extracting direct SQL table refs from .sql.
    // For code files, only extract table refs from explicit Spark APIs / SQL literals.
    const tableRefs = mergeTableRefs(
      isSqlFile ? extractSqlTableRefs(line) : [],
      extractSparkTableCalls(line),
      extractSparkSqlLiteralTables(line),
    );

    // 1) PII leakage: raw select without transform
    if (pii.length > 0) {
      const safe = isTransformed(line, config.safe_transforms_sql ?? []) || isTransformed(line, config.safe_transforms_pyspark ?? []);
      if (looksLikeSqlSelect(line) && !safe) {
        diff.push({
          file,
          file_line_number: fileLine,
          line_number: r.line_number,
          code_snippet: line.trim().slice(0, 240),
          table_refs: tableRefs,
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
          file,
          file_line_number: fileLine,
          line_number: r.line_number,
          code_snippet: line.trim().slice(0, 240),
          table_refs: tableRefs,
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
        file,
        file_line_number: fileLine,
        line_number: r.line_number,
        code_snippet: line.trim().slice(0, 240),
        table_refs: tableRefs,
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
          file,
          file_line_number: fileLine,
          line_number: r.line_number,
          code_snippet: line.trim().slice(0, 240),
          table_refs: tableRefs,
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
          file,
          file_line_number: fileLine,
          line_number: r.line_number,
          code_snippet: line.trim().slice(0, 240),
          table_refs: tableRefs,
          severity: "CRITICAL",
          violation_type: "Logic",
          remediation: `Do not join on raw PII (${pii.join(", ")}). Join on salted hash keys (e.g., email_hash) instead.`,
        });
      }
    }

    // 5) Secrets usage & hardcoded creds
    if (includesAny(line, config.secrets_tokens ?? [])) {
      diff.push({
        file,
        file_line_number: fileLine,
        line_number: r.line_number,
        code_snippet: line.trim().slice(0, 240),
        table_refs: tableRefs,
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
            file,
            file_line_number: fileLine,
            line_number: r.line_number,
            code_snippet: line.trim().slice(0, 240),
            table_refs: tableRefs,
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
    const key = `${d.file ?? ""}:${d.line_number}:${d.violation_type}:${d.code_snippet}`;
    const prev = byKey.get(key);
    if (!prev || severityRank(d.severity) > severityRank(prev.severity)) byKey.set(key, d);
  }

  return Array.from(byKey.values()).sort((a, b) => a.line_number - b.line_number);
}
