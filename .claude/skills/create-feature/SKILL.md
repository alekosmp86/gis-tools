---
name: create-feature
description: Scaffold a new feature folder under the project's features root with its category subfolders (components, hooks, context, constants, helpers, types by default), each seeded with a .gitkeep. Use when the user wants to start a new feature or domain.
allowed-tools: Bash AskUserQuestion Read
---

# Create Feature

Scaffolds a feature directory that follows the project's feature structure convention.

## Configuration

The features root and the category folders come from the project, in this order:

1. `.claude/ai-toolkit/context/structure.md` (written by discovery), keys `features_root` and `feature_dirs`.
2. Environment variables `AI_TOOLKIT_FEATURES_ROOT` and `AI_TOOLKIT_FEATURE_DIRS`.
3. Defaults: `src/features` and `components hooks context constants helpers types` (the toolkit's default convention, `conventions/feature-structure.default.md`).

If none of the first two exist and the repo already has a features folder somewhere else, ask the user before using the default.

## Steps

1. **Get the feature name.** Use `$ARGUMENTS` if given; otherwise ask "What is the feature name?" with AskUserQuestion.

2. **Normalize to kebab-case** (lowercase, spaces and underscores become hyphens, strip anything outside `[a-z0-9-]`). Example: `Order Approvals` becomes `order-approvals`. Call this `<feature>`.

3. **Resolve configuration** per the order above and export it:

   ```bash
   AI_TOOLKIT_FEATURES_ROOT="<features-root>" AI_TOOLKIT_FEATURE_DIRS="<dirs>" \
     bash "$CLAUDE_PROJECT_DIR/.claude/skills/create-feature/scaffold.sh" "<feature>"
   ```

   The script creates `<features-root>/<feature>/` (errors if it exists), one folder per category, and a `.gitkeep` in each.

4. **Feature state file.** If the project has AI Toolkit initialized (`.claude/ai-toolkit-manifest.json` exists), create `.claude/ai-toolkit/features/<feature>.state.json` with the linked spec path (ask if unknown), an empty list of acceptance criteria, and `next_gate: "spec"`.

5. **Report** the created path and the category list. Keep it short.

## Notes

- Category folders and file naming follow the project's convention (or the toolkit default), which the level 1 validation hook also enforces: `components/PascalCase.tsx`, `hooks/useCamelCase.ts`, `context/PascalCase.context.tsx`, `helpers/kebab-case.helpers.ts`, `constants/kebab-case.constants.ts`, `types/kebab-case.types.ts`.
- Feature-scoped code lives in the feature folder. Shared schemas and reusable UI primitives belong in their shared packages, not here.
- Route files stay in the framework's routing folder; features hold the domain logic and components those routes compose.
