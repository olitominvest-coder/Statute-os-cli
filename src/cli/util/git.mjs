import { execa } from "execa";

export async function isGitRepo(cwd) {
  try {
    const { stdout } = await execa("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd,
    });
    return stdout.trim() === "true";
  } catch {
    return false;
  }
}

export async function ensureBranch(cwd, branchName) {
  await execa("git", ["checkout", "-b", branchName], { cwd });
}

export async function getGitStatusPorcelain(cwd) {
  try {
    const { stdout } = await execa("git", ["status", "--porcelain"], { cwd });
    return stdout;
  } catch {
    return "";
  }
}

