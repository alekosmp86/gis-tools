# Workspace Rules

## Portable Node.js Requirement
- Always use the portable Node.js binaries from `C:\Alekos\Tools\node24portable`.
- When running commands via PowerShell, set `$env:PATH = "C:\Alekos\Tools\node24portable;" + $env:PATH` or run `C:\Alekos\Tools\node24portable\npm.cmd` / `node.exe`.

## Git Commit Control
- **NEVER execute `git commit` automatically.** Only run `git commit` when the user explicitly instructs to commit changes.

## UI & Component Architecture
- **Atomic & Reusable Components**: Never place entire pages or multi-section UIs inside a single monolithic file (like `page.tsx`).
- Decompose UI into small, atomic, reusable components in `src/components/` (e.g. `Badge`, `Button`, `SearchInput`, `ToolCard`, `Header`, `Footer`, `HeroSection`, `FilterTabs`, etc.).
- Maintain modular styling and clean separation of concerns.

## Type & Interface Separation
- **Separate Type Files**: Never define interfaces, models, or prop types inside `.tsx` component files. Leave `.tsx` files strictly for defining UI rendering logic.
- Place types and interfaces in `src/types/` (e.g. `src/types/db.ts`, `src/types/ui.ts`, `src/types/gis.ts`).

## Enums & Const Objects
- **No Raw String Literal Comparisons**: Never compare against hardcoded string literals (e.g. `type === "success"` or `category === "Todos"`).
- Always define and use const enums or object constants (e.g. `AlertType.SUCCESS`, `BadgeVariant.ACTIVE`, `ToolCategory.ALL`) stored in `src/types/`.

## Static & Mock Data Separation
- **Separate Data Files**: Never hardcode large arrays, static configuration objects, or mock datasets directly inside `.tsx` component files.
- Place static data, constants, and mock datasets in `src/data/` or `src/constants/` (e.g. `src/data/toolsData.ts`).

## Language & Localization
- **UI Language**: All user-facing UI text, titles, buttons, badges, descriptions, placeholders, and tool messages MUST be in **Spanish**.
- Developer conversation with the user remains in **English**.
