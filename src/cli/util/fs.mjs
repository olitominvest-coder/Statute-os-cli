import fs from "node:fs/promises";
import path from "node:path";

export async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

export async function writeJsonAtomic(filePath, value) {
  const dir = path.dirname(filePath);
  await ensureDir(dir);
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
  await fs.rename(tmp, filePath);
}

export async function pathExists(p) {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

export async function walkFiles(rootDir, options = {}) {
  const ignoreDirNames = new Set(
    options.ignoreDirNames ?? [
      ".git",
      "node_modules",
      ".next",
      "dist",
      "build",
      "coverage",
      ".statute",
    ],
  );

  /** @type {string[]} */
  const results = [];

  async function walk(current) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (ignoreDirNames.has(entry.name)) continue;
        await walk(fullPath);
        continue;
      }
      if (entry.isFile()) results.push(fullPath);
    }
  }

  await walk(rootDir);
  return results;
}

