import fs from "node:fs/promises";
import path from "node:path";

import ora from "ora";
import { resolveStateDir, loadState } from "../state.mjs";
import { StatuteApiClient } from "../api/client.mjs";

const RESET = "\x1b[0m";
const BOLD  = "\x1b[1m";
const GREEN = "\x1b[32m";
const DIM   = "\x1b[2m";

async function insertBadgeIntoReadme(repoRoot, markdown) {
  const readmePath = path.join(repoRoot, "README.md");
  let content;
  try {
    content = await fs.readFile(readmePath, "utf8");
  } catch {
    return null; // no README
  }

  // Replace existing statute badge, or insert after the first heading
  const badgeRe = /\[!\[AI Governance[^\]]*\]\([^)]+\)\]\([^)]+\)/g;
  if (badgeRe.test(content)) {
    const updated = content.replace(badgeRe, markdown);
    await fs.writeFile(readmePath, updated, "utf8");
    return "updated";
  }

  // Insert after first H1/H2
  const headingRe = /^(#{1,2} .+)$/m;
  const match = headingRe.exec(content);
  if (match) {
    const idx = match.index + match[0].length;
    const updated = content.slice(0, idx) + "\n\n" + markdown + content.slice(idx);
    await fs.writeFile(readmePath, updated, "utf8");
    return "inserted";
  }

  // Prepend if no heading found
  await fs.writeFile(readmePath, markdown + "\n\n" + content, "utf8");
  return "prepended";
}

export async function runBadge(opts) {
  const cwd = process.cwd();
  const stateDir = resolveStateDir(opts.config, cwd);
  const spinner = ora("Fetching badge…").start();

  try {
    const state = await loadState(stateDir);
    const assessmentId = opts.assessmentId ?? state.context?.assessment_id;
    if (!assessmentId) {
      spinner.fail("No assessment ID. Run `statute init --assessment-id <id>` first or pass --assessment-id.");
      process.exitCode = 1;
      return;
    }

    const apiUrl = opts.apiUrl ?? state.api_url;
    if (!apiUrl) {
      spinner.fail("STATUTE_API_URL not set. Run `statute init` first or pass --api-url.");
      process.exitCode = 1;
      return;
    }

    const api = new StatuteApiClient({
      apiUrl,
      token: opts.token,
      debug: opts.debug,
      stateDir,
    });

    const badge = await api.getBadge(assessmentId);
    spinner.stop();

    if (opts.json) {
      console.log(JSON.stringify(badge, null, 2));
      return;
    }

    const { markdown, html } = badge.snippets;

    if (opts.readme) {
      const action = await insertBadgeIntoReadme(cwd, markdown);
      if (action) {
        console.log(`${GREEN}✓${RESET} Badge ${action} in README.md`);
      } else {
        console.log("README.md not found — badge snippet printed below instead:");
        console.log(markdown);
      }
    } else {
      console.log();
      console.log(`${BOLD}Compliance badge for assessment ${assessmentId}${RESET}`);
      console.log();
      console.log(`  Level:     ${BOLD}${badge.badge_level?.toUpperCase()}${RESET}`);
      console.log(`  Score:     ${badge.score}/100`);
      console.log(`  Valid:     ${new Date(badge.valid_until).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`);
      console.log(`  Verify:    ${badge.public_url}`);
      console.log();
      console.log(`${BOLD}Markdown${RESET}`);
      console.log(markdown);
      console.log();
      console.log(`${BOLD}HTML${RESET}`);
      console.log(html);
      console.log();
      console.log(`${DIM}Tip: run \`statute badge --readme\` to auto-insert into README.md${RESET}`);
    }

  } catch (err) {
    spinner.fail("Badge fetch failed.");
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("404") || msg.includes("No active badge")) {
      console.error("No active badge found. Issue one from the Statute OS dashboard first.");
    } else if (opts.debug) {
      console.error(err);
    } else {
      console.error(msg);
    }
    process.exitCode = 1;
  }
}
