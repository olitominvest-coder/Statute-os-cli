import { z } from "zod";

export const LlmProviderSchema = z.enum(["openai_compat", "ollama", "lmstudio", "mock"]);

export const LlmConfigSchema = z.object({
  enabled: z.boolean().optional().default(false),
  provider: LlmProviderSchema.optional().default("openai_compat"),
  base_url: z.string().min(1).optional(),
  api_key: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  // Always false by default; can be overridden by CLI flag for explicit opt-in.
  allow_send_code: z.boolean().optional().default(false),
  // Optional system prompt override file path (relative to stateDir).
  system_prompt_path: z.string().min(1).optional(),
});

export const AutoAssessResultSchema = z.object({
  detected_use_case: z.string().min(1),
  compliance_prefill: z.object({
    legal_basis: z.string().min(1),
    data_minimization_check: z.boolean(),
    justification: z.string().min(1),
  }),
});

