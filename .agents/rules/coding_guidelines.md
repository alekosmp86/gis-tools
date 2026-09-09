# Coding Guidelines & Component Architecture

1. **Git Commit Policy**:
   - Do NOT run `git commit` unless explicitly instructed by the user.

2. **Mandatory Verification & React Doctor**:
   - Always run `npm run doctor` (or `npx react-doctor`), `npm run lint`, and `npm run build` after making any code changes.

3. **Mandatory Planning Requirement**:
   - Always plan before implementing: create or update the `implementation_plan.md` artifact before making code modifications for any complex task or feature.

4. **Atomic Component Decomposition**:
   - Keep files small, modular, and focused. Never place entire pages or multi-section UIs inside a single monolithic file.
   - Extract UI elements into small, atomic, reusable components in `src/components/ui/` or `src/components/`.

5. **Function Decomposition & Non-Monolithic Code**:
   - No monolithic functions. When adding functionalities, keep functions clean: never bloat an existing function by piling inline logic into it.
   - Always create dedicated, single-responsibility helper methods or functions for distinct tasks (queries, transforms, data calculations), and let the main function act purely as a high-level orchestrator of how they are used.

6. **Lucide Icons Only**:
   - Never use raw unicode arrow symbols (`➔`), emoji characters (`⚠️`, `✓`), or text bullets (`•`) in UI text.
   - Always import and use official SVG icons from `lucide-react`.

7. **No Inline Styles**:
   - Never use inline `style={{ ... }}` in `.tsx` files.
   - All styling, layout, spacing, and typography must be defined in modular CSS (`.module.css`).

8. **Type & Interface Separation**:
   - Place domain types, models, API contracts, state payloads, and shared data schemas in dedicated type files — never inline in a component.
   - **Ownership follows the layer** (the modular monolith split replaced the old flat `src/types/`):
     - Core domain types, models and data schemas → `src/core/types/`.
     - Presentation-only types → `src/ui-kit/types/`.
     - Contracts between the host and its modules → `src/core/modules/`.
     - A module owns its own types inside `src/modules/<id>/`. Never widen a core type file for a concern only one module has.
   - **Component Props Exception**: Component props interfaces/types (`*Props`) SHOULD be declared directly inside the `.tsx` file where the component is declared and defined.

9. **Enums & Const Objects**:
   - Never compare against raw string literals (e.g. `type === "success"` or `category === "Todos"`).
   - Define and use const enums or object constants (e.g. `AlertType.SUCCESS`, `BadgeVariant.ACTIVE`, `ToolCategory.ALL`) stored in `src/types/`.

10. **Static & Mock Data Separation**:
    - Never hardcode large arrays, static configuration objects, or mock datasets directly inside `.tsx` component files.
    - Place static data, constants, and mock datasets in `src/data/` or `src/constants/` (e.g. `src/data/toolsData.ts`).

11. **Language & Localization**:
    - **UI Language**: All user-facing UI text, titles, buttons, badges, descriptions, placeholders, and tool messages MUST be in **Spanish**.
    - Developer conversation with the user remains in **English**.

12. **Variable Naming & Self-Descriptive Identifiers**:
    - **No Single-Letter Variable Names**: Never use single-letter names for variables, parameters, lambda arguments, or loop counters (e.g. avoid `e`, `i`, `f`, `p`, `x`, `y`, `v`, `val`).
    - **Descriptive Intent**: Variable and parameter names MUST clearly indicate their purpose and content (e.g. use `event`, `index`, `feature`, `preset`, `value`, `coordinate`, `fieldIndex`).

13. **Modular Monolith Boundaries**:
    - `src/core/` imports only `core` and stays headless (no `react`, no `next/*`); `src/ui-kit/` may import `core` and `ui-kit`; `src/modules/<id>/` may import `core`, `ui-kit` and its own folder.
    - Nothing in `core/` or `ui-kit/` may import from `modules/`, and no module may import another module. `src/app/modules.registry.ts` is the only file permitted to name a module.
    - Never hand-edit generated routes under `src/app/api/m/**`; change the module's `module.routes.json` and run `npm run modules:routes`.
    - Full recipe and hard rules: `.agents/rules/module_authoring.md`.

14. **Pre-Commit Cleanliness Check**:
    - Before finalizing code changes or asking to commit, perform a quick audit to eliminate dead code, unused imports, unused exports, and deprecated functions or patterns.

15. **Issue Documentation Rule**:
    - For every new issue or bug addressed in the codebase, create a dedicated markdown file inside `docs/issues/` (e.g. `docs/issues/ISSUE_001_DESCRIPTIVE_NAME.md`) containing:
      1. Problem Statement
      2. Root Cause Analysis & Technical Details
      3. Implemented Solution
      4. Code Examples & Diff Snippets
      5. Verification & Testing
    - Always update the index in `docs/README.md`.

16. **User Addressing Requirement**:
    - Canonical source: `.agents/rules/user_addressing.md`. Role-play as **Cortana** and open every message by addressing the user as **Chief**, **Master Chief** or **Sierra-117** — never "Alekos".

17. **Minimal & Critical Comments Only**:
    - Do NOT add comments to every code change or narrate obvious implementation details.
    - Reserve comments strictly for critical, non-obvious context: subtle browser or CSS quirks (e.g. `flex-shrink: 0` beside `overflow: hidden`), complex spatial or mathematical workarounds, or essential architectural invariants.
