# Testing-First Branching & Deployment Workflow

Every code modification, bug fix, and new feature in the GIS Tools platform is promoted through the
pipeline below.

## 0. Principles

- **Tooling lives on `main`.** The branch topology governs *promotion*, never *capability*. Test
  runners, linters and configuration are part of the codebase, so every branch cuts from `main` and
  inherits the complete quality gauntlet. Tooling is never installed on `testing` alone: that would
  make the gate branch structurally different from every other branch, create a permanent conflict
  surface, be destroyed by the reset protocol in section 4, and prevent tests from being authored
  where the fix itself is written.
- **`testing` is disposable staging.** It is never a place to fix, author or accumulate work. Anything
  on it can be discarded at any moment.
- **The tested commit is the promoted commit.** Promotion is a fast-forward of the exact object that
  passed the gauntlet — never a second, separate merge that was never verified.

## 1. Local Loop — every branch, before requesting promotion

The candidate author runs the full gauntlet on their own branch. `testing` is not where failures are
discovered; it is where *integration* is confirmed.

```bash
npm run lint
npm test
npm run build
npm run doctor
```

## 2. Step 1 — Integrate `main` into the candidate

Conflicts are resolved by the author, on the candidate branch, where the context lives:

```bash
git checkout <feature-or-fix-branch>
git fetch origin
git merge origin/main
```

Re-run the local loop after integrating. The candidate now contains everything `main` has.

## 3. Step 2 — Stage the candidate on `testing`

Because the candidate already contains `main`, `testing` is simply pointed at it. No merge, therefore
no possibility of `testing` holding a combination that differs from what will be promoted:

```bash
git checkout testing
git reset --hard <feature-or-fix-branch>
```

`testing` is force-with-lease territory. If it is published, align it with
`git push --force-with-lease origin testing` — never plain `--force`, and never build work on top of
it.

## 4. Step 3 — Mandatory Quality Gauntlet

Run on `testing`, in this order — cheapest and most frequently failing first:

1. `npm run modules:routes:check` — the generated module routes match the declarations on disk.
2. `npm run lint` — 0 errors, 0 warnings.
3. `npm test` — all unit and integration suites green.
4. `npm run build` — clean Next.js Turbopack production build.
5. `npm run doctor` — **zero findings**.

### Gate notes

- **`npm run modules:routes:check` guards generated code.** Routes under `src/app/api/m/**` are
  emitted from each module's `module.routes.json` and committed, so review sees the served surface.
  `predev` and `prebuild` regenerate them automatically; the check exists for the tree that is
  committed, so a stale one cannot pass. Fix drift with `npm run modules:routes`, never by hand.
- **`npm test` is live.** The suite runs on Vitest, covering parsers, spatial math, normalizers, the
  feature/record translation and the module contracts. Playwright covers end-to-end via
  `npm run test:e2e`, which is not part of this gauntlet.
- **The doctor gate is findings-based, not score-based.** React Doctor's score API is unreachable
  behind the local TLS interception, so `Score unavailable` is expected and is not a failure. The
  criterion is that the run reports no findings.
- **Never weaken a gate to make it pass.** Tests are the specification: when a test fails because the
  code produces an incorrect result, the code is corrected — never the assertion.

## 5. Step 4 — Tactical Decision Fork

### Case A: Failures Detected (RED)

- **Do not fix on `testing`.** It is staging; changes made there are discarded.
- **Do not use `git revert`.** Revert commits pollute history with inverse deltas that can strip
  features in later merges.
- Discard the staged state and return to the candidate to debug:

  ```bash
  git checkout <feature-or-fix-branch>
  ```

- Correct the defect, re-run the local loop, then repeat from section 2.

### Case B: All Gates Green (SUCCESS)

- Promote by fast-forward, so the promoted object is byte-for-byte the object that passed:

  ```bash
  git checkout main
  git merge --ff-only <feature-or-fix-branch>
  ```

- **If the fast-forward is refused, `main` advanced during the gauntlet.** This is the safety
  mechanism working as intended: do not force it and do not fall back to a plain merge. Return to
  section 2, re-integrate, and re-run the gauntlet on the new combination.
- Push `main` to remote origin **upon explicit user instruction only**:

  ```bash
  git push origin main
  ```

- Align `testing` with the promoted state:

  ```bash
  git checkout testing
  git reset --hard main
  git push --force-with-lease origin testing
  ```

## 6. Bootstrap Exception (spent)

The change that installed the test runner could not be validated by the gauntlet it created, so it
was permitted as a one-time exception. That exception has been used: the runner and its suites now
live on `main`, and every branch inherits them. This workflow applies from here with no further
carve-outs.
