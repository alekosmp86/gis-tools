# Issue 028: Source Selector Component Atomic Decomposition

## 1. Problem Statement
The `SourceSelector.tsx` component (201 lines) had accumulated multiple distinct responsibilities:
- An inline 45-line badge renderer (`renderBadge`) switching through 5 status branches with icons and text.
- An inline add-source form managing form submission, input value state (`customUrlInput`), validation, and toggle behavior.
- Source card button rendering containing categories, titles, descriptions, and active state styles.

This inline complexity hindered readability, testability, and violated the repository's atomic component architectural standard.

## 2. Root Cause Analysis & Technical Details
- **Multi-Concern Component Co-location**: Status badge rendering, custom source creation form controls, and source button cards were bundled into a single file alongside the section header and refresh buttons.
- **Form State Leakage**: `customUrlInput` state lived in `SourceSelector`, even though it only mattered to the child addition form.

## 3. Implemented Solution
Decomposed `SourceSelector.tsx` into atomic, single-responsibility components sharing modular CSS:

1. **`SourceStatusBadge.tsx`**:
   - Encapsulates status telemetry indicators: `Verificando` (spinner), `novedades` (`Sparkles`), `Al día` (`CheckCircle`), `Sin descargar` (`HardDrive`), and `Error` (`AlertCircle`). Symmetrical with `ResourceStatusBadge.tsx`.
2. **`AddSourceForm.tsx`**:
   - Encapsulates the custom CKAN source input form and manages `customUrlInput` state hermetically.
   - Satisfies accessibility guidelines by avoiding jarring `autoFocus` attributes (`react-doctor/no-autofocus`).
3. **`WatchedSourceCard.tsx`**:
   - Encapsulates individual source card buttons with category tags, `SourceStatusBadge`, title, and description.
4. **Clean Declarative Orchestrator (`SourceSelector.tsx`)**:
   - Reduced from 201 lines down to 87 lines of declarative JSX composing `WatchedSourceCard`, `AddSourceForm`, and the header toolbar.
5. **Barrel Exports**:
   - Exported all new sub-components in `src/modules/cartography-watcher/index.ts`.

## 4. Code Examples & Diff Snippets

### Before (Monolithic renderBadge & inline form in SourceSelector.tsx):
```tsx
const renderBadge = (sourceId: string) => {
  const summary = summaries[sourceId];
  if (!summary || isCheckingSummaries) {
    return <span className={styles.badgeChecking}><RefreshCw size={12} className="animate-spin" /><span>Verificando</span></span>;
  }
  if (summary.status === SourceBadgeState.UPDATE_AVAILABLE) {
    return <span className={styles.badgeUpdate}><Sparkles size={12} /><span>{summary.updatesCount} novedades</span></span>;
  }
  // ... repeated for UP_TO_DATE, NOT_DOWNLOADED, ERROR
};

// ... inline form JSX ...
{isAddingSource && (
  <form className={styles.addSourceForm} onSubmit={handleFormSubmit}>
    <input value={customUrlInput} onChange={...} />
    ...
  </form>
)}
```

### After (Declarative Composition in SourceSelector.tsx):
```tsx
return (
  <div className={styles.container}>
    <div className={styles.headerRow}>...</div>

    {isAddingSource && onAddSource && (
      <AddSourceForm
        onAddSource={handleAddSource}
        onCancel={handleToggleAddForm}
      />
    )}

    <div className={styles.grid}>
      {sources.map((source) => (
        <WatchedSourceCard
          key={source.id}
          source={source}
          isSelected={source.id === selectedSourceId}
          summary={summaries[source.id]}
          isCheckingSummaries={isCheckingSummaries}
          onSelect={onSelectSource}
        />
      ))}
    </div>
  </div>
);
```

## 5. Verification & Testing
- **TypeScript**: `npx tsc --noEmit` passes with 0 errors.
- **ESLint**: `npm run lint` passes with 0 errors and 0 warnings.
- **React Doctor**: `npm run doctor` scores **100 / 100 Great** with 0 issues.
- **Production Build**: `npm run build` (Turbopack) compiles cleanly in 2.1s with all 13 routes generated.
