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

## Language & Localization
- **UI Language**: All user-facing UI text, titles, buttons, badges, descriptions, placeholders, and tool messages MUST be in **Spanish**.
- Developer conversation with the user remains in **English**.
