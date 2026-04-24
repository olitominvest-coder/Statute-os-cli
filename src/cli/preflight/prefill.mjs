function lc(s) {
  return String(s ?? "").toLowerCase();
}

const USE_CASES = [
  { name: "Fraud Detection", keywords: ["fraud", "chargeback", "aml", "suspicious", "risk_score"] },
  { name: "Marketing Attribution", keywords: ["marketing", "attribution", "ads", "campaign", "utm", "conversion"] },
  { name: "Healthcare Analytics", keywords: ["patient", "diagnosis", "icd", "hipaa", "clinical"] },
  { name: "Hiring / Employment Screening", keywords: ["hiring", "candidate", "interview", "recruit", "employment"] },
  { name: "Credit / Lending", keywords: ["credit", "loan", "underwriting", "fico", "lending"] },
  { name: "Biometric / Identity", keywords: ["biometric", "face", "fingerprint", "voiceprint", "kyc"] },
];

export function detectUseCase(text) {
  const t = lc(text);
  let best = { name: "Review Required", score: 0 };
  for (const u of USE_CASES) {
    const hits = u.keywords.reduce((acc, k) => acc + (t.includes(k) ? 1 : 0), 0);
    if (hits > best.score) best = { name: u.name, score: hits };
  }
  return best.score >= 2 ? best.name : "Review Required";
}

export function computeCompliancePrefill({ detectedUseCase, diffCount, criticalCount }) {
  let legalBasis = "Review Required";
  if (detectedUseCase === "Fraud Detection") legalBasis = "Legitimate Interest (candidate) — review required";
  if (detectedUseCase === "Marketing Attribution") legalBasis = "Consent (candidate) — review required";
  if (detectedUseCase === "Healthcare Analytics") legalBasis = "Public Interest / Vital Interests (candidate) — review required";

  const dataMinOk = criticalCount === 0 && diffCount <= 2;

  const justification = dataMinOk
    ? "No critical PII/egress findings detected in static preflight; data access appears scoped."
    : "Preflight detected potential PII leakage/egress patterns; requires minimization and boundary controls before production use.";

  return {
    legal_basis: legalBasis,
    data_minimization_check: dataMinOk,
    justification,
  };
}

