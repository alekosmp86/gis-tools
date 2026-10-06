#!/usr/bin/env node
// Level 0 (design doc section 6): lint the single file just written/edited. 2s budget.
// Timeout or infra failure -> warn and let through (never blocks the edit).
// Real lint failure -> reports a block decision so the agent sees and fixes it.
"use strict";

const { spawnSync } = require("child_process");

const BUDGET_MS = 2000;

function readStdin() {
  try {
    const chunks = [];
    const fs = require("fs");
    const data = fs.readFileSync(0, "utf8");
    return data;
  } catch {
    return "";
  }
}

function main() {
  let input;
  try {
    input = JSON.parse(readStdin() || "{}");
  } catch {
    console.log(JSON.stringify({ decision: "approve" }));
    return;
  }

  const filePath = input?.tool_input?.file_path || input?.tool_response?.filePath;
  if (!filePath || !/\.(ts|tsx)$/.test(filePath)) {
    console.log(JSON.stringify({ decision: "approve" }));
    return;
  }

  const result = spawnSync("npx", ["eslint", "--no-warn-ignored", filePath], {
    cwd: process.cwd(),
    timeout: BUDGET_MS,
    encoding: "utf8",
    shell: true,
  });

  if (result.error && result.error.code === "ETIMEDOUT") {
    console.log(
      JSON.stringify({
        decision: "approve",
        reason: "level-0 lint exceeded 2s budget — degraded to level 1, not blocking",
      })
    );
    return;
  }

  if (result.error) {
    console.log(
      JSON.stringify({
        decision: "approve",
        reason: `level-0 lint infra failure (${result.error.message}) — warned, not blocking`,
      })
    );
    return;
  }

  if (result.status !== 0) {
    const detail = (result.stdout || result.stderr || "").trim().slice(0, 4000);
    console.log(
      JSON.stringify({
        decision: "block",
        reason: `eslint found a real issue in ${filePath}:\n${detail}`,
      })
    );
    return;
  }

  console.log(JSON.stringify({ decision: "approve" }));
}

main();
