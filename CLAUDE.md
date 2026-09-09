# GIS Tools — Claude Code Entry Point

This file exists so Claude Code loads the workspace rules. The canonical rules live in `AGENTS.md`
(shared with other agentic tools) and in the focused rule files under `.agents/rules/`. Edit those,
never this file — it is a loader, not a source.

## Workspace rules (binding)

@AGENTS.md

## Focused rule files

Read the relevant one before working in its area; each is the canonical source for its topic and
`AGENTS.md` carries only its summary.

- `.agents/rules/model_delegation.md` — multi-model pipeline: who plans, who implements, who reviews
- `.agents/rules/module_authoring.md` — modular monolith, module boundaries, route declarations
- `.agents/rules/testing_branch_workflow.md` — the gauntlet and the promotion pipeline
- `.agents/rules/testing_standards.md` — how tests are written
- `.agents/rules/coding_guidelines.md` — code structure and style
- `.agents/rules/portable_node.md` — Node.js detection and the portable fallback
- `.agents/rules/user_addressing.md` — persona and how to address the user

## Architecture rationale

- `docs/architecture/MODULAR_MONOLITH_AND_MODULES.md` — why the module system is shaped this way
- `src/modules/status/` — the reference module; read it before authoring a new one
