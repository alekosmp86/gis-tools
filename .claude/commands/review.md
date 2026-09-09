---
description: Verify and review the implementer's finished work, then write findings to the handoff file
argument-hint: "[optional focus area]"
---

Run a full review pass. Follow `.agents/rules/code_review_standards.md` — it is the specification.

1. Read `.agents/handoff/TO_ORCHESTRATOR.md` for what the implementer claims it did. Treat it as a
   claim, never as evidence.
2. Re-run the whole gauntlet yourself. `npm` is not on PATH — prepend `C:\Alekos\Tools\node24portable`
   per `.agents/rules/portable_node.md`:
   `modules:routes:check`, `lint`, `test`, `build`, `doctor`.
3. Read the entire diff yourself. Never approve code you have not read.
4. Check the `-` lines of the test diff specifically. A weakened, skipped or deleted assertion is an
   automatic BLOCKER.
5. Dispatch a `code-reviewer` subagent with fresh context for an independent read, briefing it with
   the review standards, the binding decisions, and anything you want challenged — including your own
   planning decisions.
6. Adjudicate. Verify every finding in the code before accepting or rejecting it; a reviewer's
   prescription can itself be wrong. Reject with a stated reason.
7. Append the surviving findings to `.agents/handoff/TO_IMPLEMENTER.md` as the next numbered round,
   each with a concrete failure scenario, plus an explicit "Rejected — do not implement" section.

Report to the user: gauntlet results as real numbers, findings by severity, anything you overrode in
the subagent's report, and any finding that is your own planning error rather than the implementer's.

$ARGUMENTS
