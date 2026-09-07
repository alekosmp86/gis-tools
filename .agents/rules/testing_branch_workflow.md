# Testing-First Branching & Deployment Workflow

Every code modification, bug fix, or new feature in the GIS Tools platform must strictly adhere to the following branch promotion pipeline:

## 1. Step 1 — Sync `testing` Baseline with `main`
- When ordered to test any development, candidate branch, or bug fix:
  ```bash
  git checkout testing
  git pull origin testing
  git merge main
  ```
- Guarantees `testing` contains all latest stable production changes prior to staging.

## 2. Step 2 — Merge Candidate Branch into `testing`
- Merge the candidate feature or fix branch into the staging baseline:
  ```bash
  git merge <feature-or-fix-branch>
  ```

## 3. Step 3 — Mandatory Quality Gauntlet
- Run all quality assurance suites in sequence:
  1. `npm test` — 100% green across all unit and integration test suites.
  2. `npm run doctor` — 100 / 100 Great maintainability score.
  3. `npm run lint` — 0 errors, 0 warnings.
  4. `npm run build` — Clean Next.js Turbopack production build.

## 4. Step 4 — Tactical Decision Fork

### Case A: Failures Detected (RED)
- **DO NOT USE `git revert`**: Revert commits pollute Git history with inverse deltas that can strip features in future merges.
- **Use `git reset --hard`**:
  ```bash
  git reset --hard origin/testing
  ```
- Switch back to the candidate feature/fix branch to investigate, debug, and correct the defect before re-testing.

### Case B: All Checks Green (SUCCESS)
- Reset `testing` back to clean state:
  ```bash
  git reset --hard origin/testing
  ```
- Switch to `main` and merge the verified candidate branch:
  ```bash
  git checkout main
  git merge <feature-or-fix-branch>
  ```
- Push `main` to remote origin upon user instruction:
  ```bash
  git push origin main
  ```
- Fast-forward `testing` to align with `main` and push:
  ```bash
  git checkout testing
  git merge main
  git push origin testing
  ```
