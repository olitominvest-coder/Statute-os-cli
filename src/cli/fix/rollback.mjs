import fs from "node:fs/promises";
import path from "node:path";

import { ensureDir } from "../util/fs.mjs";

export async function createBackupSession({ stateDir }) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupRoot = path.join(stateDir, "backups", stamp);
  await ensureDir(backupRoot);
  return backupRoot;
}

export async function backupFile({ backupRoot, repoRoot, file }) {
  const rel = path.relative(repoRoot, file);
  const dest = path.join(backupRoot, rel);
  await ensureDir(path.dirname(dest));
  await fs.copyFile(file, dest);
}

export async function backupFiles({ stateDir, repoRoot, files }) {
  const backupRoot = await createBackupSession({ stateDir });
  for (const file of files) {
    await backupFile({ backupRoot, repoRoot, file });
  }
  return backupRoot;
}
