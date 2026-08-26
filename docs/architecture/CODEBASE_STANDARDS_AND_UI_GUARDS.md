# Codebase Architectural Standards & UI Execution Guards

> **Topic**: Const Object Enums, Re-execution guards, Empty Script disabling, and Disabled Button CSS.  
> **Date**: 2026-08-26  
> **Status**: Implemented & Merged to `master`

---

## 1. Const Object Enum Refactoring

### Problem
Components were using raw string literal unions (e.g. `"UPDATE" | "INSERT"` or `"success" | "error"`), which violates the workspace rule:
> *"Never compare against hardcoded string literals (e.g. type === 'success'). Always define and use const enums or object constants stored in `src/types/`."*

### Solution

Created const object enums:

#### `src/types/comparison.ts`
```typescript
export const SqlScriptType = {
  UPDATE: "UPDATE",
  INSERT: "INSERT",
} as const;

export type SqlScriptType = (typeof SqlScriptType)[keyof typeof SqlScriptType];
```

#### `src/types/ui.ts`
```typescript
export const AlertType = {
  SUCCESS: "success",
  ERROR: "error",
} as const;

export type AlertType = (typeof AlertType)[keyof typeof AlertType];
```

All usages across `SqlPatchDrawer.tsx`, `SqlExecutionModal.tsx`, and `Step4ResultsView.tsx` were updated to reference `SqlScriptType` and `AlertType`.

---

## 2. Execution State & Safety Guards (`SqlPatchDrawer.tsx`)

### Feature 1: Re-execution Guard (`executedTabs`)
- **Risk**: Executing an `INSERT` script multiple times creates duplicate records in the target table.
- **Implementation**: Added `executedTabs: Record<SqlScriptType, boolean>` state in `SqlPatchDrawer.tsx`.
- **Behavior**: Upon successful execution, `executedTabs[activeTab]` is set to `true`. The button label changes to `<CheckCircle2> Script Ejecutado` and is disabled for that tab for the remainder of the session. Tab buttons display `(Ejecutado)` suffix.

### Feature 2: Empty Script Guard (`hasExecutableStatements`)
- **Risk**: When no attribute discrepancies exist, the `UPDATE` script contains only header comment lines (0 executable statements).
- **Implementation**: Regular expression validation:
  ```typescript
  const hasExecutableStatements =
    activeTab === SqlScriptType.UPDATE
      ? /UPDATE\s+/i.test(activeScript)
      : /INSERT\s+INTO\s+/i.test(activeScript);
  ```
- **Behavior**: If `hasExecutableStatements` is `false`, the "Ejecutar en BD" button is automatically disabled with a descriptive tooltip.

---

## 3. Disabled Button Styling (`Button.tsx` & `Button.module.css`)

### Problem
The `Button` component previously lacked CSS styles for disabled states, rendering disabled buttons identical to active ones.

### Solution

#### `src/components/ui/Button.tsx`
Updated to combine custom `isDisabled` and native `disabled` HTML props:
```typescript
const isEffectiveDisabled = Boolean(isDisabled || disabled);
```

#### `src/components/ui/Button.module.css`
Added sleek dark slate disabled styles:
```css
.disabled,
.button:disabled {
  background: rgba(30, 41, 59, 0.65);
  color: #94a3b8;
  border-color: rgba(148, 163, 184, 0.15);
  cursor: not-allowed;
  opacity: 0.7;
}
```
