# Codebase Standards & UI Architectural Rules — GIS Tools

This document outlines the mandatory engineering standards, component boundaries, styling rules, and type separation policies for the **GIS Tools** codebase.

---

## 📐 1. Component & Styling Rules

### A. Atomic & Reusable Components
- Never place entire pages or multi-section UIs inside a single monolithic file (like `page.tsx`).
- Decompose UI into small, atomic, reusable components inside `src/components/` (e.g., `Badge`, `Button`, `SearchInput`, `ToolCard`, `Header`, `Footer`, `HeroSection`, `FilterTabs`, `MapStylePopover`, etc.).

### B. Zero Inline Styles (`style={{ ... }}`) Policy
- **Never use inline `style={{ ... }}` objects in `.tsx` files.**
- All component styling, layout, spacing, colors, and animations MUST be defined inside CSS Modules (`.module.css`).
- Dynamic dimensions (such as progress bar percentages or canvas heights) must be updated via clean DOM element ref callbacks (`ref={(element) => { if (element) element.style.width = `${pct}%`; }}`) or CSS custom properties.

### C. Lucide Icons Exclusively
- **Always import and render SVG icons from `lucide-react`.**
- Never use raw unicode arrow symbols (`➔`), emoji characters (`⚠️`, `✓`), or text bullets (`•`) in UI text.

---

## 🏷️ 2. Type & Model Separation Rules

### A. Co-location of Component Props Interfaces (`*Props`)
- Component props interfaces (e.g., `*Props`) **MUST be declared directly inside the `.tsx` file** where the component is declared and defined.
- Do NOT place component props interfaces inside `src/types/`.

### B. Domain Models & Schemas Location (`src/types/`)
- Shared domain models, API schemas, state payloads, and database configuration types MUST be placed in dedicated files inside `src/types/`:
  - [`db.ts`](file:///c:/Alekos/Projects/gis-tools/src/types/db.ts) — Database connection and execution payload models.
  - [`comparison.ts`](file:///c:/Alekos/Projects/gis-tools/src/types/comparison.ts) — Discrepancy types, comparison summary models, and mapping configurations.
  - [`ui.ts`](file:///c:/Alekos/Projects/gis-tools/src/types/ui.ts) — Tool categories, badges, button variants, and wizard step definitions.
  - [`parsers.ts`](file:///c:/Alekos/Projects/gis-tools/src/types/parsers.ts) — Parsed file dataset schemas.
- Do NOT create barrel re-export files (such as `src/types/gis.ts`). Import models directly from their home module.

---

## 🔤 3. Variable Naming & Identifier Standards

### A. No Single-Letter Variable Names
- Never use single-letter variable names for variables, parameters, lambda arguments, or loop counters (avoid `e`, `i`, `f`, `p`, `x`, `y`, `v`, `val`, `c`, `h`, `d`).
- Variable and parameter names MUST clearly indicate their purpose and content:
  - Form event handlers: `(event: React.ChangeEvent) => ...`
  - Loop index counters: `for (let index = 0; index < length; index++)`
  - Coordinate pairs: `(xCoordinate: number, yCoordinate: number)`
  - Profiles / Items / Columns: `(profile: SavedDbProfile)`, `(column: string)`

---

## 🌐 4. Language & Localization Standards

- **User-Facing UI Text**: All user-facing UI text, labels, button captions, titles, badges, placehoders, and modal messages MUST be written in **Spanish**.
- **Developer Conversation & Documentation**: Project documentation (`README.md`, `docs/`, code comments, commit messages) MUST be written in **English**.
