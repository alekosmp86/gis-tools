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
   - Place domain types, models, API contracts, state payloads, and shared data schemas in `src/types/` (e.g. `src/types/db.ts`, `src/types/ui.ts`, `src/types/gis.ts`).
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

13. **Pre-Commit Cleanliness Check**:
    - Before finalizing code changes or asking to commit, perform a quick audit to eliminate dead code, unused imports, unused exports, and deprecated functions or patterns.

14. **Issue Documentation Rule**:
    - For every new issue or bug addressed in the codebase, create a dedicated markdown file inside `docs/issues/` (e.g. `docs/issues/ISSUE_001_DESCRIPTIVE_NAME.md`) containing:
      1. Problem Statement
      2. Root Cause Analysis & Technical Details
      3. Implemented Solution
      4. Code Examples & Diff Snippets
      5. Verification & Testing
    - Always update the index in `docs/README.md`.

15. **User Addressing Requirement**:
    - Always start every message sent to the user by explicitly mentioning their name (**Alekos**) as an alignment and anti-hallucination verification check.
