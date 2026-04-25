import { describe, expect, test } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { scanRepo } from "../src/cli/scan/index.mjs";

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

describe("scan profiles", () => {
  test("auto profile skips AI controls when no AI deps found", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "statute-scan-profile-"));
    try {
      await writeJson(path.join(tmp, "package.json"), { name: "x", version: "1.0.0", dependencies: {} });
      const out = await scanRepo({ repoRoot: tmp, profile: "auto" });
      const log = out.findings.find((f) => f.control_id === "CODE-AI-LOG-001");
      expect(log).toBeTruthy();
      expect(log.status).toBe("skipped");
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  test("auto profile detects Python AI deps and enables AI controls", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "statute-scan-profile-"));
    try {
      await fs.writeFile(path.join(tmp, "requirements.txt"), "openai==1.0.0\n", "utf8");
      const out = await scanRepo({ repoRoot: tmp, profile: "auto" });
      const log = out.findings.find((f) => f.control_id === "CODE-AI-LOG-001");
      expect(log).toBeTruthy();
      expect(["pass", "fail", "warning"]).toContain(log.status);
      expect(log.status).not.toBe("skipped");
      expect(out.findings.some((f) => f.control_id === "AGENT-001")).toBe(true);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  test("data profile does not emit AGENT-* governance controls", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "statute-scan-profile-"));
    try {
      await fs.writeFile(path.join(tmp, "requirements.txt"), "openai==1.0.0\n", "utf8");
      const out = await scanRepo({ repoRoot: tmp, profile: "data" });
      expect(out.findings.some((f) => f.control_id.startsWith("AGENT-"))).toBe(false);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});

