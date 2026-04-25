import { z } from "zod";

export const PreflightSeveritySchema = z.enum(["CRITICAL", "MEDIUM", "LOW"]);
export const PreflightViolationTypeSchema = z.enum(["PII Leakage", "Egress", "Logic"]);

export const PreflightTableRefSchema = z.object({
  name: z.string().min(1),
  kind: z.enum(["from", "join", "table_call", "spark_sql_literal"]),
  confidence: z.enum(["high", "medium", "low"]),
});

export const PreflightDiffItemSchema = z.object({
  file: z.string().min(1).optional(),
  file_line_number: z.number().int().nonnegative().optional(),
  line_number: z.number().int().nonnegative(),
  code_snippet: z.string(),
  table_refs: z.array(PreflightTableRefSchema).optional(),
  severity: PreflightSeveritySchema,
  violation_type: PreflightViolationTypeSchema,
  remediation: z.string(),
});

export const PreflightOutputSchema = z.object({
  readiness_summary: z.object({
    score: z.number().min(0).max(100),
    status: z.enum(["PASS", "WARN", "FAIL"]),
    detected_use_case: z.string(),
  }),
  security_diff: z.array(PreflightDiffItemSchema),
  compliance_prefill: z.object({
    legal_basis: z.string(),
    data_minimization_check: z.boolean(),
    justification: z.string(),
  }),
  nudge: z.string(),
});
