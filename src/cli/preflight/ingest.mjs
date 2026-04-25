import fs from "node:fs/promises";
import path from "node:path";

import { walkFiles } from "../util/fs.mjs";

async function readText(filePath) {
  return await fs.readFile(filePath, "utf8");
}

function shouldIgnoreFile(filePath) {
  const p = String(filePath ?? "");
  return (
    p.includes(`${path.sep}.git${path.sep}`) ||
    p.includes(`${path.sep}node_modules${path.sep}`) ||
    p.includes(`${path.sep}.venv${path.sep}`) ||
    p.includes(`${path.sep}venv${path.sep}`) ||
    p.includes(`${path.sep}__pycache__${path.sep}`) ||
    p.includes(`${path.sep}site-packages${path.sep}`) ||
    p.includes(`${path.sep}dist${path.sep}`) ||
    p.includes(`${path.sep}build${path.sep}`)
  );
}

function normalizeLines(text) {
  return String(text ?? "").replace(/\r\n/g, "\n").split("\n");
}

async function ingestSqlFile(filePath, startLineNumber) {
  const text = await readText(filePath);
  const lines = normalizeLines(text);
  return lines.map((line, idx) => ({
    file: filePath,
    line_number: startLineNumber + idx,
    file_line_number: idx + 1,
    code: line,
  }));
}

async function ingestPyFile(filePath, startLineNumber) {
  const text = await readText(filePath);
  const lines = normalizeLines(text);
  return lines.map((line, idx) => ({
    file: filePath,
    line_number: startLineNumber + idx,
    file_line_number: idx + 1,
    code: line,
  }));
}

async function ingestIpynb(filePath, startLineNumber) {
  const raw = await readText(filePath);
  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    // Fall back to raw lines
    return await ingestPyFile(filePath, startLineNumber);
  }

  const cells = Array.isArray(json?.cells) ? json.cells : [];
  const out = [];
  let lineNo = startLineNumber;
  let fileLineNo = 1;
  for (const cell of cells) {
    if (cell?.cell_type !== "code") continue;
    const src = Array.isArray(cell.source) ? cell.source.join("") : String(cell.source ?? "");
    const lines = normalizeLines(src);
    for (const line of lines) {
      out.push({ file: filePath, line_number: lineNo, file_line_number: fileLineNo, code: line });
      lineNo += 1;
      fileLineNo += 1;
    }
    // keep separation to make line numbers stable-ish
    out.push({ file: filePath, line_number: lineNo, file_line_number: fileLineNo, code: "" });
    lineNo += 1;
    fileLineNo += 1;
  }
  return out;
}

export async function ingestPreflightTarget(targetPath) {
  const abs = path.isAbsolute(targetPath) ? targetPath : path.join(process.cwd(), targetPath);
  const stat = await fs.stat(abs);
  const files = stat.isDirectory() ? await walkFiles(abs) : [abs];

  const candidates = files
    .filter((f) => /\.(sql|py|ipynb)$/i.test(f))
    .filter((f) => !shouldIgnoreFile(f));
  let globalLine = 1;
  /** @type {Array<{file: string, line_number: number, file_line_number?: number, code: string}>} */
  const records = [];
  for (const f of candidates) {
    // eslint-disable-next-line no-await-in-loop
    let rows = [];
    if (f.toLowerCase().endsWith(".sql")) rows = await ingestSqlFile(f, globalLine);
    else if (f.toLowerCase().endsWith(".py")) rows = await ingestPyFile(f, globalLine);
    else if (f.toLowerCase().endsWith(".ipynb")) rows = await ingestIpynb(f, globalLine);
    records.push(...rows);
    globalLine = (rows.at(-1)?.line_number ?? globalLine) + 3;
  }

  return { records, files: candidates };
}
