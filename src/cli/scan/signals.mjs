import path from "node:path";

export function computeSignals({ repoRoot, files, aiSdks }) {
  const hasPromptsDir = files.some((f) => /[\/\\](prompts|system_prompts)[\/\\]/.test(f));
  const hasAuditModule = files.some((f) => /statute[\/\\]audit\.(ts|js|mjs|cjs)$/.test(f));
  const hasModelCard = files.some((f) => /model[-_ ]card/i.test(path.basename(f)));
  const hasPurposeDocs = files.some((f) => /purpose/i.test(path.basename(f)) && /\.(md|txt)$/.test(f));
  const hasLangChainDep = (aiSdks ?? []).includes("langchain");

  return {
    repoRoot,
    aiSdks,
    hasPromptsDir,
    hasAuditModule,
    hasAuditWrapperUsage: false,
    hasLangChainDep,
    hasLangChainUsage: false,
    hasHitlHandlerUsage: false,
    hasModelCard,
    hasPurposeDocs,
  };
}
