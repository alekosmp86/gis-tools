---
description: Investigate a task and write a self-contained brief for the implementer
argument-hint: "<what to build or fix>"
---

Plan the task below. You are the orchestrator: you decide, you do not implement.

1. Investigate in this session. Diagnosis is never delegated — read the real code and find the root
   cause or the real constraints before designing anything.
2. Make the binding decisions yourself: architecture, module boundaries, data models, API contracts,
   identity and migration rules. State each one and why, so the implementer cannot silently revisit it.
3. Decide explicitly what is **out of scope**, with reasons. An unstated exclusion gets implemented.
4. Append a new section to `.agents/handoff/TO_IMPLEMENTER.md` — never overwrite the file. The brief
   must be self-contained: the implementer has no conversation context. Include branch name,
   `file:line` pointers you already found, the rules files that bind the work
   (`AGENTS.md` plus the relevant `.agents/rules/*.md`), required test coverage by name, the full
   gauntlet as the definition of done, and "do not commit".
5. Note that `npm` is not on PATH — the brief must point at `C:\Alekos\Tools\node24portable`.

Then tell the user the decisions and the risks in a few lines. Do not write implementation code.

Task: $ARGUMENTS
