import path from "node:path";

import { pathExists, readJson } from "../util/fs.mjs";

export function defaultPreflightConfig() {
  return {
    pii_columns: [
      "email",
      "e_mail",
      "ssn",
      "sin",
      "phone",
      "full_name",
      "name",
      "dob",
      "address",
      "credit_card",
      "cc_number",
      "passport",
      "ip_address",
    ],
    safe_transforms_sql: ["sha2", "mask", "anonymize", "regexp_replace", "xxhash64", "hash", "aes_encrypt"],
    safe_transforms_pyspark: ["sha2", "hash", "xxhash64", "regexp_replace", "when"],
    egress_blocklist_tokens: [
      "display(",
      ".collect(",
      ".toPandas(",
      "toPandas(",
      "df.toPandas(",
      "requests.get(",
      "requests.post(",
      "urllib.request",
      "httpx.get(",
      "httpx.post(",
      "boto3.",
      "google.cloud.storage",
      "azure.storage.blob",
    ],
    secrets_tokens: ["dbutils.secrets.get", "dbutils.secrets.get("],
    cred_patterns: [
      { name: "aws_access_key", re: "AKIA[0-9A-Z]{16}" },
      { name: "private_key_block", re: "-----BEGIN (RSA |EC |)PRIVATE KEY-----" },
      { name: "password_assign", re: "(?i)password\\s*=\\s*['\\\"][^'\\\"]+['\\\"]" },
      { name: "conn_string", re: "(?i)(jdbc:|postgresql://|mysql://|snowflake://|mongodb://)" },
    ],
  };
}

export async function loadPreflightConfig({ stateDir }) {
  const filePath = path.join(stateDir, "preflight.json");
  if (!(await pathExists(filePath))) return defaultPreflightConfig();
  try {
    const json = await readJson(filePath);
    return { ...defaultPreflightConfig(), ...(json ?? {}) };
  } catch {
    return defaultPreflightConfig();
  }
}

