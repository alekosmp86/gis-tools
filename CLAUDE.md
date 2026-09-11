# GIS Tools — Topic Reference & Context Index

Load files on-demand based on the task to conserve context tokens. Do not load all docs upfront.

## Critical Code Output Formatting (Token Optimization)
* Speak like a caveman.
* Never use preambles, introductory filler, or pleasantries (e.g., do not say "Sure, I can help with that" or "Here is the modified file").
* Jump directly into the solution. 
* Do not write long summaries explaining why you changed code unless explicitly asked.
* Maximize code blocks, minimize natural language paragraphs. Keep explanations under 1-2 punchy sentences.
* Do not add comments in code changes unless strictly critical.

## Rules & Development Workflow
- `AGENTS.md` — Workspace summary rules (architecture, conventions, persona, quality gates).
- `.agents/rules/model_delegation.md` — Multi-model pipeline: planning, implementation, review.
- `.agents/rules/testing_branch_workflow.md` — Gauntlet, promotion pipeline, branching standards.
- `.agents/rules/testing_standards.md` — Test structure, AAA pattern, boundary coverage.
- `.agents/rules/code_review_standards.md` — Review focus: correctness, architecture, SOLID, God components, duplication as a size signal.
- `.agents/rules/handoff_commands.md` — Shared command vocabulary: `/plan` `/build` `/review` `/apply` `/drop` `/hold` `/commit` `/promote` `/push` `/where`.
- `.agents/rules/architecture_navigation.md` — Consult the generated dependency graph (`npm run graph`, `docs/architecture/dependency-graph.html`) for "where is X" / architecture / module-connection questions before scanning source; use its file-level data to target exact files, then narrow to line-level with `Grep` instead of reading whole files.
- `.agents/rules/coding_guidelines.md` — Code structure, types, modular CSS, no inline styles.
- `.agents/rules/module_authoring.md` — Modular monolith, boundaries, JSON route manifests.
- `.agents/rules/portable_node.md` — Portable Node.js fallback (`C:\Alekos\Tools\node24portable`).
- `.agents/rules/user_addressing.md` — Persona and user addressing conventions.

## Architecture & System Design
- `docs/architecture/MODULAR_MONOLITH_AND_MODULES.md` — Modular monolith design and boundary contracts.
- `docs/architecture/ARCHITECTURE.md` — General system architecture and data pipelines.
- `docs/architecture/WIZARD_ORCHESTRATOR_ARCHITECTURE.md` — Wizard step orchestrator and state machines.
- `src/modules/cartography-watcher/` — Reference module implementation.

## Tools & Domain Documentation
- `docs/tools/` — Specific tool documentation (`DB_CSV_SYNC_TOOL.md`, `DB_SHAPEFILE_SYNC_TOOL.md`, `DB_DB_SYNC_TOOL.md`, `FILE_VIEWER_TOOL.md`, `POSTGIS_TABLE_VIEWER_TOOL.md`, `CARTOGRAPHY_WATCHER_MODULE.md`).
- `docs/specifications/` — Functional requirements and specifications.

## Troubleshooting & Past Fixes
- `docs/README.md` — Complete documentation map and issue directory.
- `docs/issues/` — Root-cause analyses, diffs, and verification for past issues (001–027).