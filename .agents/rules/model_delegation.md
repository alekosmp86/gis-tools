# Multi-Model Delegation Workflow

Work in this repository is delivered by a pipeline that assigns each phase to the cheapest model
that can do it well. The orchestrating session reasons; a cheaper model implements; the
orchestrating model reviews what the cheaper one produced.

Global configuration lives in `~/.claude/` and applies to every project:
`CLAUDE.md` (the policy), `agents/implementer.md`, `agents/code-reviewer.md`,
`agents/git-operator.md`, and `skills/dev-cycle/SKILL.md` (the full protocol).

## 0. Role assignment

| Phase | Actor | Model |
|---|---|---|
| Triage, planning, decomposition | main session (orchestrator) | Opus 5 |
| Implementation, tests, fix rounds | Antigravity session / `implementer` | Gemini 3.8 Flash / Sonnet 5 |
| Code review of the finished diff | `code-reviewer` agent / Claude session | Opus 5, fresh context |
| Adjudication of findings | main session (orchestrator) | Opus 5 |
| Commit, merge, push | Antigravity session / `git-operator` agent | Gemini 3.8 Flash / Haiku 4.5 |

**Dual-Session Split (Claude + Antigravity)**:
- **Claude (Opus)** drives high-level reasoning, system architecture, task decomposition, and writes/maintains `implementation_plan.md`.
- **Antigravity (Gemini)** acts as the dedicated implementer: ingests `implementation_plan.md`, applies code modifications, writes tests, runs the quality gauntlet, and verifies cleanly.
- **Claude (Opus)** runs a fresh-context review against `git diff` before approval and branch promotion.

**The reviewer is a separate agent/context even though it shares the orchestrator's model.** It starts with
no memory of the plan, so it cannot rationalise a flaw the way its author would. The orchestrator
then adjudicates with the plan context the reviewer lacks. The split is the point.

## 1. The loop

```
plan  ->  implementer  ->  code-reviewer  ->  adjudicate
                 ^                                 |
                 |____ fix round (max 3) __________|
                                                   |
                                                   v
                                            git-operator
                                    (explicit user instruction only)
```

Fixes are code, so a fix round always returns to review. After three rounds with findings still
surviving, the orchestrator stops looping and takes the work over or returns to the user — a loop
that will not converge signals a flawed plan, not a lazy implementer.

## 2. Scope — when the pipeline engages

Engaged by default for features, bug fixes, refactors, new or changed tests, and anything spanning
multiple files or more than roughly twenty lines.

Handled inline without delegation: typos, comments and documentation, a verified one-line change,
config value tweaks, a tool-verified mechanical rename, and all reading, explaining and
investigation. When it is unclear, the task is not trivial.

Diagnosis is never delegated — an unknown root cause is reasoning work and belongs to the
orchestrator. Only the fix is delegated.

## 3. Briefing — subagents start cold

A subagent inherits **no** conversation context. Every brief is self-contained: task, repo and
branch, the plan artifact path, `file:line` pointers the orchestrator already found, the project
rules files to honour, explicit requirements, required test coverage, **explicit out-of-scope**,
and the definition of done. An underspecified brief produces a confident, wrong implementation.

Every brief must point at `AGENTS.md` and the relevant `.agents/rules/*.md`, since those carry this
project's binding constraints on layering, naming, styling, UI language and testing.

## 4. Interaction with the existing workflow

- **Planning rule** — the orchestrator writes or updates `implementation_plan.md` before delegating,
  satisfying the mandatory planning requirement, and points the implementer at that file.
- **Quality gauntlet** — the `implementer` runs the full local loop
  (`modules:routes:check`, `lint`, `test`, `build`, `doctor`) on its own branch before reporting,
  and pastes real output. Review never runs against unverified code.
- **Tests as specification** — the implementer may never weaken an assertion to reach green, and
  the reviewer treats a weakened, skipped or deleted test as an automatic BLOCKER.
- **Branch promotion** — the committing session (Antigravity, or `git-operator`) follows
  `.agents/rules/testing_branch_workflow.md` exactly: integrate `main`, stage on `testing` by reset,
  run the gauntlet, promote by `--ff-only`, and `--force-with-lease` only on `testing`.
- **Commit control** — the standing "never commit automatically" rule is unchanged and binds the
  orchestrator too. The committing session acts only on operations named explicitly in its brief,
  and a push is never implied by a commit.

## 5. Severity taxonomy

The reviewer ranks every finding, and the ranking decides whether another round happens.

- **BLOCKER** — wrong behaviour, data loss, crash or security hole in normal use; or a test
  weakened, skipped or deleted to force green. Fix before commit.
- **MAJOR** — a real defect on a less common path, a genuine performance problem at realistic
  scale, a violated project rule, or a meaningful coverage gap. Fix before commit.
- **MINOR** — real but low impact. Batched into a round that is happening anyway, otherwise
  reported to the user.
- **NIT** — cosmetic. Never triggers a round.

Every finding above NIT must carry a concrete failure scenario: specific inputs or state, and the
resulting wrong output, crash or cost. A finding without one is a preference.

## 6. Orchestrator obligations

- Delegate execution, never judgement. Architecture, layer boundaries, module contracts, data
  models and dependency choices are decided by the orchestrator.
- Never delegate a task not understood first, and never approve a diff not read.
- Verify a finding in the code before rejecting it. Rejecting a real bug because you designed the
  thing is precisely the bias this pipeline exists to defeat.
- Report faithfully. A subagent's failure, skipped gate or partial result reaches the user in plain
  terms — delegation must never launder an unverified claim into a confident summary.
