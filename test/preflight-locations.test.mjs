import { describe, expect, test } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runPreflight } from "../src/cli/preflight/engine.mjs";
import { defaultPreflightConfig } from "../src/cli/preflight/config.mjs";

describe("preflight locations and hints", () => {
  test("ignores vendored dirs like .venv", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "statute-preflight-venv-"));
    try {
      await fs.mkdir(path.join(tmp, ".venv"), { recursive: true });
      await fs.writeFile(path.join(tmp, ".venv", "bad.py"), "display(df)\n", "utf8");
      await fs.writeFile(path.join(tmp, "main.py"), "# ok\n", "utf8");
      const out = await runPreflight({
        targetPath: tmp,
        config: defaultPreflightConfig(),
        allowedPrefixes: ["dbfs:/Volumes/cleanroom/"],
        stateDir: path.join(tmp, ".statute"),
        autoAssess: false,
      });
      expect(out.security_diff.length).toBe(0);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  test("does not treat Python imports as SQL table refs", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "statute-preflight-import-"));
    try {
      await fs.writeFile(path.join(tmp, "x.py"), "from urllib.request import Request, urlopen\n", "utf8");
      const out = await runPreflight({
        targetPath: tmp,
        config: defaultPreflightConfig(),
        allowedPrefixes: ["dbfs:/Volumes/cleanroom/"],
        stateDir: path.join(tmp, ".statute"),
        autoAssess: false,
      });
      expect(out.security_diff.length).toBeGreaterThan(0);
      expect(out.security_diff[0].violation_type).toBe("Egress");
      expect(out.security_diff[0].table_refs).toBeUndefined();
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});

