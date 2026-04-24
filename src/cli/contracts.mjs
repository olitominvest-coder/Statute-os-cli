import { z } from "zod";

export const CLI_CONTRACT_VERSION = "cli_contract_v1";

export const AssessmentContextSchema = z.object({
  jurisdictions: z.array(z.string().min(1)).default([]),
  risk_tier: z.enum(["low", "medium", "high"]).default("medium"),
  assessment_ref: z.string().min(1).optional(),
  assessment_id: z.string().uuid().optional(),
});

export const ProjectFingerprintSchema = z.object({
  repo_root_hint: z.string().min(1),
  git_remote_hash: z.string().min(1).optional(),
  package_manager: z.enum(["npm", "pnpm", "yarn", "unknown"]).default("unknown"),
  languages: z.array(z.string()).default([]),
  iac: z.array(z.string()).default([]),
  ai_sdks: z.array(z.string()).default([]),
});

export const ScanFindingSchema = z.object({
  control_id: z.string().min(1),
  status: z.enum(["pass", "fail", "warning", "skipped"]),
  severity: z.enum(["critical", "high", "medium", "low"]),
  evidence_meta: z.string().max(1024),
  artifacts: z
    .array(z.object({ path_hash: z.string().min(1), kind: z.string().min(1) }))
    .default([]),
});

export const MatchRequestSchema = z.object({
  schema_version: z.literal(CLI_CONTRACT_VERSION),
  context: AssessmentContextSchema,
  project: ProjectFingerprintSchema,
  findings: z.array(ScanFindingSchema),
});

export const MatchResponseSchema = z.object({
  schema_version: z.literal(CLI_CONTRACT_VERSION),
  gaps: z.array(
    z.object({
      gap_id: z.string().min(1),
      control_id: z.string().min(1),
      remediation_template_id: z.string().min(1).nullable().optional(),
      confidence: z.number().min(0).max(1).optional(),
    }),
  ),
});

export const ManifestSchema = z.object({
  schema_version: z.literal(CLI_CONTRACT_VERSION),
  fetched_at: z.string().min(1),
  context: AssessmentContextSchema,
  mappings: z.array(
    z.object({
      control_id: z.string().min(1),
      gap_id: z.string().min(1),
      remediation_template_id: z.string().min(1).nullable().optional(),
      severity: z.enum(["critical", "high", "medium", "low"]).optional(),
    }),
  ),
});

export const CreditsResponseSchema = z.object({
  organization: z
    .object({
      id: z.string().min(1).optional(),
      name: z.string().min(1).nullable().optional(),
      subscription_tier: z.string().min(1).nullable().optional(),
    })
    .nullable()
    .optional(),
  credits: z
    .object({
      assessment_credits: z.number().int().nullable().optional(),
      scan_credits: z.number().int().nullable().optional(),
    })
    .optional(),
  usage: z
    .object({
      assessments: z.number().int().optional(),
      scans: z.number().int().optional(),
    })
    .optional(),
});

export const TemplateSchema = z.object({
  schema_version: z.literal("cli_template_v1"),
  template_id: z.string().min(1),
  gap_id: z.string().min(1),
  target: z.object({ globs: z.array(z.string().min(1)) }),
  operations: z.array(
    z.discriminatedUnion("op", [
      z.object({
        op: z.literal("ensure_import"),
        from: z.string().min(1),
        named: z.array(z.string().min(1)).default([]),
      }),
      z.object({
        op: z.literal("wrap_call"),
        callee: z.string().min(1),
        wrapper: z.string().min(1),
      }),
      z.object({
        op: z.literal("langchain_hitl_guardrail"),
        import_from: z.string().min(1).default("./statute/hitl"),
        handler: z.string().min(1).default("StatuteHITLCallbackHandler"),
      }),
    ]),
  ),
  postfix_audit: z.object({ control_ids: z.array(z.string().min(1)) }).optional(),
  integrity: z
    .object({
      sha256: z.string().min(1),
      signature: z.string().min(1),
    })
    .optional(),
});
