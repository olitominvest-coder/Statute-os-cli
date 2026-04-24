import { describe, expect, test } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runPreflight } from "../src/cli/preflight/engine.mjs";
import { defaultPreflightConfig } from "../src/cli/preflight/config.mjs";

describe("preflight", () => {
  test("flags raw PII select", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "statute-public-preflight-"));
    try {
      await fs.writeFile(path.join(tmp, "q.sql"), "select email from users;\n", "utf8");
      const out = await runPreflight({
        targetPath: tmp,
        config: defaultPreflightConfig(),
        allowedPrefixes: ["dbfs:/Volumes/cleanroom/"],
        stateDir: path.join(tmp, ".statute"),
        autoAssess: false,
      });
      expect(out.readiness_summary.status).toBe("FAIL");
      expect(out.security_diff.length).toBeGreaterThan(0);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});
