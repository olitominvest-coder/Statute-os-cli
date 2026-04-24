import fs from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";

import { ensureDir } from "../util/fs.mjs";

async function diffNoIndex({ repoRoot, beforePath, afterPath }) {
  const { stdout } = await execa(
    "git",
    ["diff", "--no-index", "--", beforePath, afterPath],
    { cwd: repoRoot, reject: false },
  );
  return stdout;
}

export async function writePatchFile({ repoRoot, pairs, outPath }) {
  await ensureDir(path.dirname(outPath));
  const chunks = [];
  for (const { beforePath, afterPath } of pairs) {
    chunks.push(await diffNoIndex({ repoRoot, beforePath, afterPath }));
  }
  await fs.writeFile(outPath, chunks.filter(Boolean).join("\n"), "utf8");
}
