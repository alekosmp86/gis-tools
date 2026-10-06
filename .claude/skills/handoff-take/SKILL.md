---
name: handoff-take
description: Pick up work handed off from a previous session. Reads the gitignored handoff.md at the repo root, verifies it against the actual repo state, asks the user clarifying questions BEFORE touching anything, then builds the todo list and resumes. Use at the start of a session when the user says "take the handoff", "pick up where we left off", "resume the handoff", or when a handoff.md exists and the user asks to continue prior work.
allowed-tools: Read Bash AskUserQuestion TodoWrite
---

# Handoff — Take

Resumes work described in `$CLAUDE_PROJECT_DIR/handoff.md` (written by the
`handoff-set` skill in a previous session). The handoff is a brief, not gospel:
verify it, question it, then act.

## Steps

1. **Read `handoff.md`** at the repo root.
   - If it does not exist, stop and tell the user there is no handoff to take
     (suggest running `handoff-set` in the session that has the context).

2. **Verify against reality.** The repo may have moved since the handoff.
   Run in parallel and diff against what the file claims:
   - `git status --porcelain` — do the uncommitted files in _Active Files_
     still exist / still match?
   - `git log --oneline -10` — do the referenced commits exist? Any NEW
     commits after the handoff was written?
   - Spot-check 1–2 key files from _Active Files_ actually exist.

   Note every mismatch — these become questions.

3. **Ask the user questions (AskUserQuestion) — always, before any work.**
   Cover, as applicable:
   - **Mismatches** found in step 2 (e.g. "handoff says X is uncommitted but
     the tree is clean — was it committed/reverted?").
   - **Ambiguities** in the handoff — anything a stranger couldn't act on.
   - **Standing holds** — e.g. "do not commit X yet": is the hold still on?
   - **Priority** — confirm the first item in _Next Steps_ is still the
     priority, or whether the user wants to reorder/drop items.

   Keep it to the questions that actually change what you'd do (1–4).

4. **Build the todo list** (TodoWrite) from _Next Steps_, adjusted by the
   user's answers. First actionable item → `in_progress`.

5. **Resume work** at that first item, honoring everything in _Failed
   Attempts_ (do not retry known-dead approaches) and any user directives
   quoted in _Goal_.
   - If _Failed Attempts_ contains an `UNRESOLVED LOOP` entry, treat the
     previous session's diagnosis as untrusted: START with fresh research
     (re-read primary sources, reproduce the symptom yourself) before
     attempting any fix. Only the raw facts (error messages, repro steps)
     carry over — not the theory.

## Notes

- Do NOT delete `handoff.md` after taking it — it stays as local scratch
  until the next `handoff-set` overwrites it.
- If the handoff conflicts with what the user says NOW, the user wins.
