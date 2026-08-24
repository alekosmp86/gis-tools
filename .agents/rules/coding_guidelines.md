# Coding Guidelines & Component Architecture

1. **Git Commit Policy**:
   - Do NOT run `git commit` unless explicitly instructed by the user.

2. **Mandatory Verification & React Doctor**:
   - Always run `npm run doctor` (or `npx react-doctor`), `npm run lint`, and `npm run build` after making any code changes.

3. **Lucide Icons Only**:
   - Never use raw unicode arrow symbols (`➔`), emoji characters (`⚠️`, `✓`), or text bullets (`•`) in UI text.
   - Always import and use icons from `lucide-react`.

4. **Atomic Component Decomposition**:
   - Keep files small, modular, and focused.
   - Extract UI elements into atomic components in `src/components/ui/` or `src/components/`.

5. **No Inline Styles**:
   - Never use inline `style={{ ... }}` in `.tsx` files.
   - All styling must be defined in modular CSS (`.module.css`).

6. **Type & Interface Separation**:
   - Keep `.tsx` files strictly for UI. Move all interfaces, props types, and domain models to `src/types/` (e.g. `src/types/db.ts`, `src/types/ui.ts`, `src/types/gis.ts`).

7. **Enums & Const Objects**:
   - Never compare against raw string literals (e.g. `type === "success"`).
   - Use const enums or object constants (e.g. `AlertType.SUCCESS`, `BadgeVariant.ACTIVE`, `ToolCategory.ALL`) defined in `src/types/`.

8. **Static & Mock Data Separation**:
   - Keep `.tsx` files clean by extracting static lists, mock data, and configuration objects into `src/data/` (e.g. `src/data/toolsData.ts`).
