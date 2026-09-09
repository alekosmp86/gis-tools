# Handoff Commands

The shared vocabulary between the user, the orchestrator (Claude / Opus) and the implementer
(Antigravity / Gemini). One word replaces a paragraph. Both agents read this file; both must honour
every verb addressed to their lane.

All work still flows through `.agents/handoff/` — see `.agents/rules/model_delegation.md` §3b. A
command says *what to do*; the handoff files remain *the record of what was said*.

## Work

| Command | Lane | Means |
|---|---|---|
| `/plan <goal>` | orchestrator | Investigate, decide the binding decisions, append a new plan section to `TO_IMPLEMENTER.md`. No code. |
| `/build` | implementer | Execute the newest round in `TO_IMPLEMENTER.md` exactly, run the full gauntlet, append a report to `TO_ORCHESTRATOR.md`. Never commit. |
| `/review` | orchestrator | Re-run the gauntlet independently, read the whole diff, run a fresh-context review against `.agents/rules/code_review_standards.md`, adjudicate, append the findings as the next round in `TO_IMPLEMENTER.md`. |

`/review` never trusts `TO_ORCHESTRATOR.md`. A pasted gauntlet is a claim; the orchestrator re-runs it.

## Disposition — acting on the other side's feedback

Symmetric: type it in whichever session owns the decision. Ids are the finding labels (`F1`, `R2`,
`G4`…). With no ids, the verb applies to every open finding in the newest round.

| Command | Means |
|---|---|
| `/apply [ids]` | Act on these findings now. |
| `/drop <ids> [reason]` | Dismiss them. The reason is recorded in the handoff file — a dropped finding is never silently forgotten. |
| `/hold <ids> [reason]` | Real, but not now. Recorded as deferred, excluded from the round, and restated at the end of the mission so it is not lost. |

The receiving agent writes the disposition into its handoff file **before** acting, so the record
shows what was asked, what was refused and why.

## Version control — implementer lane, explicit instruction only

Never inferred, never chained. `/commit` does not imply `/push`.

| Command | Means |
|---|---|
| `/commit [message]` | Stage and commit on the current branch. Nothing else. Untracked generated routes must be staged explicitly. |
| `/promote` | Run `.agents/rules/testing_branch_workflow.md` end to end: integrate `main`, stage on `testing` by reset, gauntlet, promote by `--ff-only`. |
| `/push` | Push the current branch. `--force-with-lease` only on `testing`. |

## Status

| Command | Lane | Means |
|---|---|---|
| `/where` | either | One short answer: branch, round number, gauntlet state, open findings by id, what is uncommitted, and who is holding the ball. No re-running, no re-reviewing. |

## Rules of the vocabulary

- **A command is an instruction, not a suggestion.** `/apply` means implement, not evaluate whether
  to implement. Disagreement is voiced *before* acting, or recorded via `/drop`.
- **Unknown verb, or a verb outside your lane** — say so and stop. Do not guess. An implementer
  asked to `/review` says it is the orchestrator's lane.
- **Nothing is committed without `/commit`, `/promote` or `/push`.** This overrides any inference
  from the work being finished or approved.
- **Commit at round boundaries.** A mission with no commits cannot be reviewed round-over-round; the
  reviewer can only diff against `main` and loses the ability to see what a fix round actually
  changed.
