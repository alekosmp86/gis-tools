#!/usr/bin/env node
// Level 1 (design doc section 6): run tests related to the files changed this turn. 30s budget.
// Timeout or infra failure -> warn and let through, degrading the rest to level 2.
// Real test failure -> blocks (reported to the agent to fix before continuing).
"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");

const BUDGET_MS = 30000;

function changedSourceFiles() {
  const diff = spawnSync("git", ["diff", "--name-only", "HEAD"], { encoding: "utf8" });
  const status = spawnSync("git", ["status", "--porcelain"], { encoding: "utf8" });
  const fromDiff = (diff.stdout || "").split("\n").filter(Boolean);
  const fromStatus = (status.stdout || "")
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3));
  const files = Array.from(new Set([...fromDiff, ...fromStatus]));
  return files.filter((file) => /\.(ts|tsx)$/.test(file) && !file.includes("node_modules"));
}

function main() {
  let files;
  try {
    files = changedSourceFiles();
  } catch (error) {
    console.log(
      JSON.stringify({
        decision: "approve",
        reason: `level-1 related-tests infra failure (${error.message}) — warned, not blocking`,
      })
    );
    return;
  }

  if (files.length === 0) {
    console.log(JSON.stringify({ decision: "approve" }));
    return;
  }

  // Drive-letter case matters: a lowercase "c:" drive cwd makes vitest load two module instances
  // ("Cannot read properties of undefined (reading 'config')", every file "0 test").
  let cwd = process.cwd();
  try {
    cwd = fs.realpathSync.native(cwd);
  } catch {
    // keep process.cwd()
  }

  const result = spawnSync("npx", ["vitest", "related", "--run", ...files], {
    cwd,
    timeout: BUDGET_MS,
    encoding: "utf8",
    shell: true,
  });

  if (result.error && result.error.code === "ETIMEDOUT") {
    console.log(
      JSON.stringify({
        decision: "approve",
        reason: "level-1 related tests exceeded 30s budget — degraded to level 2, not blocking",
      })
    );
    return;
  }

  if (result.error) {
    console.log(
      JSON.stringify({
        decision: "approve",
        reason: `level-1 related-tests infra failure (${result.error.message}) — warned, not blocking`,
      })
    );
    return;
  }

  if (result.status !== 0) {
    const detail = `${result.stdout || ""}\n${result.stderr || ""}`.trim().slice(0, 4000);
    console.log(
      JSON.stringify({
        decision: "block",
        reason: `related tests failed for changed files (${files.join(", ")}):\n${detail}`,
      })
    );
    return;
  }

  console.log(JSON.stringify({ decision: "approve" }));
}

main();
