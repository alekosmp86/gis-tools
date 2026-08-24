# Coding Guidelines & Component Architecture

1. **Git Commit Policy**:
   - Do NOT run `git commit` unless explicitly instructed by the user.

2. **Atomic Component Decomposition**:
   - Keep files small, modular, and focused.
   - Extract UI elements into atomic components in `src/components/ui/` or `src/components/`.

3. **Type & Interface Separation**:
   - Keep `.tsx` files strictly for UI. Move all interfaces, props types, and domain models to `src/types/` (e.g. `src/types/db.ts`, `src/types/ui.ts`, `src/types/gis.ts`).

4. **Enums & Const Objects**:
   - Never compare against raw string literals (e.g. `type === "success"`).
   - Use const enums or object constants (e.g. `AlertType.SUCCESS`, `BadgeVariant.ACTIVE`, `ToolCategory.ALL`) defined in `src/types/`.

5. **Static & Mock Data Separation**:
   - Keep `.tsx` files clean by extracting static lists, mock data, and configuration objects into `src/data/` (e.g. `src/data/toolsData.ts`).
