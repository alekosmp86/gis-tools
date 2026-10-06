---
name: handoff-set
description: Hand off the current session's work to a future session without carrying over a cluttered context. Distills the conversation into a gitignored handoff.md at the repo root (Goal / Current State / Active Files / Changes Made / Failed Attempts / Next Steps). Use when the user says "hand off", "handoff", "wrap up for the next session", or is about to close/compact a long session mid-task.
allowed-tools: Bash Read Write Edit
---

# Handoff — Set

Writes `$CLAUDE_PROJECT_DIR/handoff.md` — a self-contained brief that lets a
**fresh** session resume this work with zero prior context. The file is local
scratch state (gitignored), never committed.

## Rules

- **Write for a stranger.** The next session sees ONLY this file. No "as
  discussed above", no references to this conversation. Quote the user's
  binding directives verbatim where they constrain the work.
- **Facts over narrative.** Paths with line numbers, exact commands, exact
  error messages, commit hashes. Prefer `file.ts:42` over "in the helper".
- **Failed Attempts is the most valuable section.** Anything tried that did
  NOT work goes there with the reason, so the next session doesn't burn time
  repeating it.
- **Flag unresolved loops honestly.** If the user has asked for the same fix
  repeatedly and it is STILL not solved, say so explicitly: this session's
  approach/diagnosis is likely wrong ("rotten context"). Do NOT hand over the
  failing theory as if it were the plan — mark it `UNRESOLVED LOOP` and
  instruct the next session to re-research from first principles (re-read the
  primary sources, reproduce the symptom fresh) instead of continuing from
  this session's assumptions.
- **Overwrite** any existing `handoff.md` — it describes one handoff, not a log.

## Steps

1. **Ground truth first.** Run in parallel:
   - `git status --porcelain` and `git diff --stat` (uncommitted work → Active Files / Changes Made)
   - `git log --oneline -10` (recent commits this effort produced)

2. **Distill the session** into the six sections below. Pull from the current
   todo list, the user's messages (quote directives verbatim), and the ground
   truth above — not from memory alone.

3. **Write `handoff.md`** at the repo root with EXACTLY this structure:

   ```markdown
   # Handoff — <one-line task title> (<YYYY-MM-DD>)

   ## 1. Goal

   What we are ultimately trying to achieve and WHY. Include the user's
   binding directives, quoted verbatim.

   ## 2. Current State

   Where things stand right now: what works, what is verified (and HOW it
   was verified — commands, gates, tests), what is committed vs uncommitted,
   any holds the user placed (e.g. "do not commit X yet").

   ## 3. Active Files

   Bullet list: `path` — one-line role in this task. Mark (NEW) / (MODIFIED)
   / (uncommitted). Include key read-only references (specs, analysis docs).

   ## 4. Changes Made

   What was changed and the intent behind each change. Reference commits by
   hash + subject; describe uncommitted edits precisely.

   ## 5. Failed Attempts

   Each: what was tried → exact failure (error message verbatim) → root
   cause → what to do instead. Include tooling hazards discovered.

   If the user requested the same outcome multiple times and it never
   landed, add an `### UNRESOLVED LOOP: <symptom>` entry: quote the user's
   repeated request, list every attempt in the loop (all failed), state
   plainly that the diagnosis is unproven, and direct the next session to
   research the symptom from scratch (primary sources, fresh repro) rather
   than trust anything this session concluded about it.

   ## 6. Next Steps

   Ordered, actionable list. First item = the exact point work stopped, with
   the concrete command/edit to resume. Include verification steps (build,
   typecheck, gates) and the intended commit message if one was planned.
   ```

4. **Ensure it is gitignored.** Check `.gitignore` for `handoff.md`; if
   missing, add it (with a short comment). Verify:
   `git check-ignore handoff.md` must succeed.

5. **Report** — one line: path written + section word counts, and remind the
   user the next session picks it up with the `handoff-take` skill.
