export function matchFindingsToGapIds(findings, manifest) {
  const mapping = new Map((manifest?.mappings ?? []).map((m) => [m.control_id, m]));
  return findings
    .filter((f) => f.status === "fail" || f.status === "warning")
    .map((f) => {
      const m = mapping.get(f.control_id);
      if (!m) return null;
      return {
        gap_id: m.gap_id,
        control_id: f.control_id,
        remediation_template_id: m.remediation_template_id ?? null,
      };
    })
    .filter(Boolean);
}
