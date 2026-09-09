# ISSUE 022: React Function High Control-Flow Complexity Decomposition

## 1. Problem Statement
Running `npx react-doctor` flagged maintainability warnings across multiple components due to elevated control-flow complexity (`react-doctor/no-high-complexity-react-function`):
- `src/components/tools/db-csv-sync/CsvUploader.tsx` (cyclomatic complexity: 21, cognitive complexity: 14)
- `src/components/tools/db-shapefile-sync/ShapefileUploader.tsx` (cyclomatic complexity: 23, cognitive complexity: 15)
- `src/modules/cartography-watcher/components/ResourceCard.tsx` (cyclomatic complexity: 20, cognitive complexity: 13)

The high control-flow complexity rendered these components difficult to reason about, maintain, and test, mixing drag-and-drop input handling, extension rendering, loading branches, error branches, and metadata visualization directly inside top-level component bodies.

## 2. Root Cause Analysis & Technical Details
The canonical threshold for `react-doctor/no-high-complexity-react-function` is triggered when a component or hook accumulates cyclomatic complexity or cognitive complexity above 15. The underlying causes for each affected site were:

1. **`CsvUploader.tsx`**:
   - Monolithically contained file dropzone event listeners (`onDragOver`, `onDragLeave`, `onDrop`, `onKeyDown`), file input refs, and conditional checks.
   - Inlined the entire loaded file summary card with attribute chips, geometry badges, and spatial preview map mounting logic.
   - Repeated auto-load effect orchestration logic.

2. **`ShapefileUploader.tsx`**:
   - Duplicated the exact same drag-and-drop event orchestration and keyboard accessibility handlers as `CsvUploader`.
   - Repeated the conditional source tab switching (`activeSourceTab === "PC" || !activeExtension`) and extension selector mounting directly within the render body.

3. **`ResourceCard.tsx`**:
   - Nested internal status badge rendering with multi-branch switch/ternary logic (`renderStatusBadge`).
   - Inlined target sync URL resolution (`getTargetSyncUrl`) using multiple query string parameter checks and URL encoding operations.
   - Rendered local vault file indicators and remote sync action buttons in a single monolithic JSX return tree.

## 3. Implemented Solution
In accordance with atomic UI component architecture and custom hook extraction standards:

1. **Extracted Shared Drag-and-Drop Hook (`src/hooks/useFileDrop.ts`)**:
   - Encapsulates `isDragOver` state, `fileInputRef`, drag event listeners (`handleDragOver`, `handleDragLeave`, `handleDrop`), change events (`handleFileChange`), keyboard events (`handleKeyDown`), and file dialog trigger (`openFileDialog`).
   - Keeps complexity within the hook down to ~4.

2. **Extracted Shared File Source Selection Area (`src/components/shared/FileSourceSelectionArea.tsx`)**:
   - Combines hidden file inputs, `FileSourceTabs`, active extension selector, and `FileDropzone`.
   - Reusable across all spatial uploaders (`CsvUploader` and `ShapefileUploader`).

3. **Extracted Dedicated Metadata Cards**:
   - `src/components/tools/db-csv-sync/LoadedCsvCard.tsx`: Dedicated atomic card presenting loaded CSV metadata, columns, and spatial map preview.
   - `src/components/tools/db-shapefile-sync/LoadedShapefileCard.tsx`: Dedicated atomic card for Shapefile metadata and geometry preview.

4. **Decomposed `ResourceCard.tsx`**:
   - `ResourceStatusBadge.tsx`: Single-responsibility badge component rendering localized status chips for `DeltaStatus` values.
   - `ResourceVaultSection.tsx`: Atomic component rendering local cached file status, modification timestamps, and file sizes.
   - Extracted `getTargetSyncUrl` helper function outside the component body.

## 4. Code Examples & Diff Snippets

### Before: Monolithic Drag & Drop and Extension Logic in `ShapefileUploader.tsx`
```tsx
// Repeated across CsvUploader and ShapefileUploader
const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
  const files = event.target.files;
  if (files && files.length > 0) processFile(files[0]);
};
const handleDragOver = (event: React.DragEvent) => { event.preventDefault(); setIsDragOver(true); };
const handleDrop = (event: React.DragEvent) => { /* ... */ };

return (
  <div className={styles.container}>
    <input type="file" ref={fileInputRef} onChange={handleFileChange} />
    {!data && !loading && <FileSourceTabs ... />}
    {!data && !loading && activeExtension && activeExtension.renderSelector(...)}
    {!data && !loading && (activeSourceTab === "PC" || !activeExtension) && <FileDropzone ... />}
    {/* ... */}
  </div>
);
```

### After: Composed with Atomic `FileSourceSelectionArea`
```tsx
return (
  <div className={styles.container}>
    {!data && !loading && (
      <FileSourceSelectionArea
        extensions={extensions}
        activeTabId={activeSourceTab}
        onSelectTab={setSelectedTabId}
        format="SHP"
        onSelectFile={processFile}
        isLoading={loading}
        accept=".zip,.geojson,.json"
        inputAriaLabel="Seleccionar archivo Shapefile o GeoJSON"
        dropzoneTitle="Arrastre y suelte su archivo Shapefile (.zip) o GeoJSON aquí"
        dropzoneSubtitle="o haga clic para seleccionar un archivo desde su equipo"
        dropzoneFormatBadges={[".ZIP (SHP + DBF)", ".GEOJSON"]}
      />
    )}

    {loading && <LoadingSpinner />}
    {errorMessage && <AlertMessage type={AlertType.ERROR} text={errorMessage} />}
    {data && <LoadedShapefileCard data={data} onDiscard={handleDiscard} />}
  </div>
);
```

## 5. Verification & Testing
- **React Doctor**:
  ```bash
  npx react-doctor@latest --verbose
  ```
  Result:
  ```
  ✔ Scanned 183 files in 8.6s
  React Doctor — gis-tools
  Score: 100 / 100 Great
  ✔ No issues found!
  ```
  All instances of `react-doctor/no-high-complexity-react-function` completely resolved.
- **ESLint**:
  ```bash
  npm run lint
  ```
  Result: 0 errors, 0 warnings.
