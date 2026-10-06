# Repo hygiene

Evidence: `git ls-files` filtered for common tool-output/cache/secret patterns; `.gitignore` read directly.

## Already clean
`.gitignore` already excludes `/coverage`, `/playwright-report/`, `/test-results/`, `/.next/`, `/out/`, `/build`, `.env*`, `*.tsbuildinfo`, `/data/vault/*` (with a `.gitkeep` carve-out), and — notably — `/graphify-out` is **already present**, even though Graphify was not installed on this machine until this run. No committed coverage reports, caches, `.next` output, or `.env` files were found in `git ls-files`.

## Minor, non-blocking
- A handful of early commit subjects carry a stray leading UTF-8 BOM character (e.g. `﻿feat(address-dedup): ...`). Cosmetic only; not worth a cleanup commit on its own.

## Pre-existing partial toolkit scaffolding (evidence for the manifest, not a hygiene defect)
`.claude/ai-toolkit-design.en.md` and `.claude/ai-toolkit/feature-structure.default.md` were already present in the repo before this run, with no `.claude/ai-toolkit-manifest.json`. These are toolkit reference files, already correctly placed per the design doc's own destinations — nothing to move or reclassify.
