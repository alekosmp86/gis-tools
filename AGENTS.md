# Workspace Rules

## Node.js Detection & Portable Fallback Requirement
- **Node.js Environment Detection**: Detect whether system Node.js is installed and available in the `PATH`.
- **System Node**: If system Node.js is installed and functioning, run standard `node` and `npm` commands directly.
- **Portable Fallback**: If system Node.js is not available, fall back to using the portable Node.js binaries from `C:\Alekos\Tools\node24portable` (e.g. by setting `$env:PATH = "C:\Alekos\Tools\node24portable;" + $env:PATH` or using `C:\Alekos\Tools\node24portable\npm.cmd`).

## Mandatory Planning Requirement
- **Always plan before implement**: Exercise judgement and create or update the `implementation_plan.md` artifact before making code modifications for any complex task or feature.

## Git Commit Control
- **NEVER execute `git commit` automatically.** Only run `git commit` when the user explicitly instructs to commit changes.

## Verification & React Doctor Requirement
- **Mandatory React Doctor Execution**: Always run `npm run doctor` (or `npx react-doctor`) along with `npm run lint` and `npm run build` after making any code changes.

## UI & Component Architecture
- **Atomic & Reusable Components**: Never place entire pages or multi-section UIs inside a single monolithic file (like `page.tsx`).
- Decompose UI into small, atomic, reusable components in `src/components/` (e.g. `Badge`, `Button`, `SearchInput`, `ToolCard`, `Header`, `Footer`, `HeroSection`, `FilterTabs`, etc.).
- Maintain modular styling and clean separation of concerns.

## Lucide Icons Only
- **Always Use Lucide Icons**: Never use raw unicode arrow symbols (`➔`), emoji characters (`⚠️`, `✓`), or text bullets (`•`) in UI text. Always import and render official SVG icons from `lucide-react`.

## No Inline Styles
- **Zero Inline `style={{ ... }}`**: Never use inline `style` objects in `.tsx` component files.
- Place all styling, typography, spacing, and layout rules inside modular CSS files (`.module.css`).

## Type & Interface Separation
- **Separate Type Files for Domain Models & API Contracts**: Place domain types, models, API contracts, state payloads, and shared data schemas in `src/types/` (e.g. `src/types/db.ts`, `src/types/ui.ts`, `src/types/gis.ts`).
- **Component Props Exception**: Component props interfaces/types (e.g. `*Props`) SHOULD be declared directly inside the `.tsx` file where the component is declared and defined.

## Enums & Const Objects
- **No Raw String Literal Comparisons**: Never compare against hardcoded string literals (e.g. `type === "success"` or `category === "Todos"`).
- Always define and use const enums or object constants (e.g. `AlertType.SUCCESS`, `BadgeVariant.ACTIVE`, `ToolCategory.ALL`) stored in `src/types/`.

## Static & Mock Data Separation
- **Separate Data Files**: Never hardcode large arrays, static configuration objects, or mock datasets directly inside `.tsx` component files.
- Place static data, constants, and mock datasets in `src/data/` or `src/constants/` (e.g. `src/data/toolsData.ts`).

## Language & Localization
- **UI Language**: All user-facing UI text, titles, buttons, badges, descriptions, placeholders, and tool messages MUST be in **Spanish**.
- Developer conversation with the user remains in **English**.

## Variable Naming & Self-Descriptive Identifiers
- **No Single-Letter Variable Names**: Never use single-letter names for variables, parameters, lambda arguments, or loop counters (e.g. avoid `e`, `i`, `f`, `p`, `x`, `y`, `v`, `val`).
- **Descriptive Intent**: Variable and parameter names MUST clearly indicate their purpose and content (e.g. use `event`, `index`, `feature`, `preset`, `value`, `coordinate`, `fieldIndex`).

## Pre-Commit Cleanliness Check
- **Dead Code & Unused Exports Removal**: Before finalizing code changes or asking to commit, perform a quick audit to eliminate dead code, unused imports, unused exports, and deprecated functions or patterns.

## Issue Documentation Rule
- **Document Every Addressed Issue**: For every new issue or bug addressed in the codebase, create a new dedicated markdown file inside `docs/issues/` (e.g. `docs/issues/ISSUE_001_DESCRIPTIVE_NAME.md`).
- **Required Sections**:
  1. **Problem Statement**: Clear description of the unexpected behavior or symptom observed by the user.
  2. **Root Cause Analysis & Technical Details**: Why the issue occurred, affected components, and data/coordinate flow breakdown.
  3. **Implemented Solution**: Architectural or code changes made to resolve the issue.
  4. **Code Examples & Diff Snippets**: Before/after code snippets or practical examples demonstrating the fix.
  5. **Verification & Testing**: Commands and results proving the issue is resolved and regressions prevented.
- **Documentation Index Update**: Always add the newly created issue document to the index in `docs/README.md`.

## Function Decomposition & Non-Monolithic Code
- **No Monolithic Functions**: Do not create monolithic functions. Functions with many lines or multiple responsibilities MUST be decomposed into smaller, focused, single-responsibility functions or helper methods, with the main function acting as a clean orchestrator.

