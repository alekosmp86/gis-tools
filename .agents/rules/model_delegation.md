# Agent Pipeline (AI Toolkit)

Work in this repository is delivered by three agents under `.claude/agents/`, generated and
maintained by AI Toolkit (`/ai-toolkit-init`, design doc section 7). The Antigravity/Gemini
dual-session pipeline and the `.agents/handoff/` channel it used are retired in this repo.

## 0. Role assignment

| Phase | Actor | Model |
|---|---|---|
| Triage, planning, decomposition, adjudication | main session (orchestrator) | Sonnet 5 |
| Production code | `implementer` agent | Sonnet 5 |
| Tests, in a separate run from the code they test | `test-writer` agent | Sonnet 5 |
| Acceptance-criteria traceability (inform mode) | `traceability-reviewer` agent | Sonnet 5 |
| Commit, merge, push | orchestrator, on explicit user instruction | Sonnet 5 |

**Why `test-writer` is separate from `implementer`**: if the same agent writes test and code, the
test validates what the code does, not what it should. The separation is meant to be technical
(a `PreToolUse` hook denying writes outside each agent's allowed paths), not just a prompt
convention — but **that hook does not currently work**: agent-scoped hooks declared in a subagent's
frontmatter are documented but non-functional for subagents in the installed Claude Code version
(upstream bugs #95650 / #18392; confirmed by spike during `/ai-toolkit-init`, recorded in
`.claude/ai-toolkit-manifest.json` as `spikes.agent_scoped_hooks: "failed"`). Until Claude Code fixes
this, or a `settings.json`-level hook keyed on the `agent_type` field of the hook input is built and
verified, the split is enforced only by each agent's own instructions and by the test globs below.

Test globs (learned in discovery, `.claude/ai-toolkit/context/structure.md`):
`tests/unit/**/*.test.ts`, `tests/e2e/**`.

## 1. The loop

```
plan (orchestrator) -> implementer -> test-writer -> traceability-reviewer (inform) -> adjudicate
                              ^                                                            |
                              |______________________ fix round (max 3) ___________________|
```

A fix round is code, so it returns to the same loop. After three rounds with findings still
surviving, the orchestrator stops looping and takes the work over or returns to the user.

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
branch, the feature state file path (if one exists for this work), `file:line` pointers the
orchestrator already found, the project rules files to honour, explicit requirements, required test
coverage, **explicit out-of-scope**, and the definition of done.

Every brief must point at `AGENTS.md` and the relevant `.agents/rules/*.md`, since those carry this
project's binding constraints on layering, naming, styling, UI language and testing.

## 4. Interaction with the existing workflow

- **Quality gauntlet** — `implementer`/`test-writer` run the full local loop
  (`modules:routes:check`, `lint`, `test`, `build`, `doctor`) on their own branch before reporting,
  and paste real output. Review never runs against unverified code.
- **Tests as specification** — neither agent may weaken an assertion to reach green; the
  `traceability-reviewer` and the orchestrator treat a weakened, skipped or deleted test as an
  automatic BLOCKER.
- **Branch promotion** — the orchestrator (or whoever commits, on explicit instruction) follows
  `.agents/rules/testing_branch_workflow.md` exactly: integrate `main`, stage on `testing` by reset,
  run the gauntlet, promote by `--ff-only`, and `--force-with-lease` only on `testing`.
- **Commit control** — the standing "never commit automatically" rule is unchanged. A push is never
  implied by a commit.

## 5. Severity taxonomy

Review scope, focus and obligations are defined in `.agents/rules/code_review_standards.md`, which
every review brief must point at. A green gauntlet admits a diff to review; it never concludes one —
architecture, SOLID, God components and duplication are judged explicitly, in writing, on every pass.

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
- **Never run the gauntlet, the dev server, or any build/test/lint command in the orchestrator
  session itself** — including "just to verify." That is execution; delegate it to `implementer`/
  `test-writer` or fold it into a subagent's brief, then read the real pasted output.
- Never delegate a task not understood first, and never approve a diff not read.
- Verify a finding in the code before rejecting it.
- Report faithfully. A subagent's failure, skipped gate or partial result reaches the user in plain
  terms — delegation must never launder an unverified claim into a confident summary.
