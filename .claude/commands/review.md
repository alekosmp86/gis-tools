---
description: Verify and review the implementer's finished work, then write findings to the handoff file
argument-hint: "[optional focus area]"
---

Run a full review pass. Follow `.agents/rules/code_review_standards.md` — it is the specification.

1. Read `.agents/handoff/TO_ORCHESTRATOR.md` for what the implementer claims it did. Treat it as a
   claim, never as evidence.
2. Read the entire diff yourself. Never approve code you have not read.
3. Check the `-` lines of the test diff specifically. A weakened, skipped or deleted assertion is an
   automatic BLOCKER.
4. Dispatch a `code-reviewer` subagent with fresh context for an independent read. The orchestrator
   never runs the gauntlet itself — that is execution, not judgement. Fold an independent gauntlet
   re-run into this same subagent's brief instead (it carries Bash/PowerShell): `modules:routes:check`,
   `lint`, `test`, `build`, `doctor`, and it must paste real output back, not a summary. `npm` is not
   on PATH — its brief must say to prepend `C:\Alekos\Tools\node24portable` per
   `.agents/rules/portable_node.md`. Brief it with the review standards, the binding decisions, and
   anything you want challenged — including your own planning decisions.
5. Adjudicate. Verify every finding in the code before accepting or rejecting it; a reviewer's
   prescription can itself be wrong. Reject with a stated reason.
6. Append the surviving findings to `.agents/handoff/TO_IMPLEMENTER.md` as the next numbered round,
   each with a concrete failure scenario, plus an explicit "Rejected — do not implement" section.

Report to the user: gauntlet results as real numbers (from the subagent's pasted output), findings by
severity, anything you overrode in the subagent's report, and any finding that is your own planning
error rather than the implementer's.

$ARGUMENTS
