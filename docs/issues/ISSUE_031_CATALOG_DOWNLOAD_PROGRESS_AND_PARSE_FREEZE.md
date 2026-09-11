# ISSUE 031: Catalogue-File Download Progress Feedback & Spatial Parser Main-Thread Freeze

## 1. Problem Statement
When downloading large spatial datasets (e.g. 50MB–200MB shapefiles or 100k+ row CSVs) from watched CKAN cartography catalogues, users faced two distinct blocking bottlenecks:
1. **Opaque Download Freezes**: When selecting a remote catalogue resource in `CatalogTreeSelector`, `fetchCatalogFile` used `response.blob()`, which provided zero visibility into download progress or byte counts. The resource button appeared disabled with no percentage or byte counter, giving the impression of an unresponsive UI or stalled connection.
2. **Main-Thread Event Loop Freeze**: Once downloaded (or dropped locally), parsing large files in `CsvParser` and `ShapefileParser` executed synchronous CPU-bound loops decoding coordinates, records, and geometry features. This starved the browser's event loop for multiple consecutive seconds, completely freezing CSS animations, microtask queues, and user input.
3. **Missing Feedback in Sync Uploaders**: Both `CsvUploader` and `ShapefileUploader` only displayed an indeterminate spinner (`<Loader2>`) during parsing, leaving users unaware of the actual parsing stage, row counts, or remaining time.

---

## 2. Root Cause Analysis & Technical Details

### A. Non-Streaming HTTP Fetching
`fetchCatalogFile` in `watcherClient.ts` performed a standard `await response.blob()`:
```ts
const response = await fetch(`${API_BASE}/catalog/file?...`);
return new File([await response.blob()], filename);
```
Because the response stream was not read incrementally via `ReadableStreamDefaultReader` (`response.body.getReader()`), progress callbacks could not be emitted as network chunks arrived.

### B. Unyielding Synchronous Parser Execution
In `CsvParser.ts` and `ShapefileParser.ts`, loops over tens of thousands of rows/features were completely synchronous:
```ts
for (let recordIndex = 0; recordIndex < previewLimit; recordIndex++) {
  // Synchronous geometry decompression, DBF decoding, and Map indexing
}
```
Without yielding control to the browser runtime periodically, the JavaScript main thread was monopolized by JavaScript execution, delaying render frames and input events.

### C. Static Loading State in Uploaders
The file upload components (`CsvUploader.tsx` and `ShapefileUploader.tsx`) only had a boolean `loading` state paired with a static text message and spinner, lacking live numeric progress feedback.

---

## 3. Implemented Solution

### A. Macrotask Yielding Primitive
Created `yieldToMainThread()` in `src/core/common/mainThreadYield.ts` using `new Promise((resolve) => setTimeout(resolve, 0))`. A macrotask timer was chosen over `requestAnimationFrame` because it guarantees execution in both browser and headless Node/Vitest environments while reliably interleaving browser layout/paint tasks.

### B. Chunked Parsing with Event-Loop Yielding
Defined `PARSE_PROGRESS_CHUNK_SIZE = 2000` in `src/core/constants/parserConstants.ts`.
- `CsvParser`: `processRows` was made asynchronous, reporting progress via `onProgress?.("Procesando filas CSV...", recordIndex, totalRows)` and invoking `await yieldToMainThread()` every 2,000 rows, concluding with a 100% completion callback.
- `ShapefileParser`: Feature extraction in both the binary shapefile/DBF loop and GeoJSON preview feature loop now yields every 2,000 records, emitting `"Extrayendo geometrías..."` or `"Procesando entidades GeoJSON..."`.
- Per Architecture Decision D6, `BinaryDbfReader` remains untouched because its constructor only parses header bytes and field descriptors (lazy decoding happens in `ShapefileParser`).

### C. ReadableStream Chunk Download with Byte Throttling in `watcherClient`
Refactored `fetchCatalogFile` to read from `response.body.getReader()`. To prevent UI re-render thrashing during rapid chunk arrival, `DOWNLOAD_PROGRESS_BYTE_INTERVAL = 64 * 1024` (64 KB) (defined in `src/modules/cartography-watcher/constants.ts`) throttles progress emissions. An initial chunk callback guarantees immediate feedback, followed by intermediate emissions spaced at least 64 KB apart, and an unconditional terminal 100% update.

### D. Progress Bar UI Integration
- `CatalogTreeSelector.tsx`: Integrated download progress tracking into `selectFileMutation`, displaying percentage or "Descargando..." badge with `Loader2` directly within the active resource row.
- `CsvUploader.tsx` and `ShapefileUploader.tsx`: Integrated the established `ProgressBar` (D2 pattern) to display live phase name, record counts, and percentage bar while parsing.

### E. Type Separation & Layer Ownership Compliance
In strict conformance with project rules on Type & Interface Separation:
- No domain types, state payloads, or request interfaces were left inline inside component `.tsx` files.
- `FileParseProgress`: Declared in `src/core/types/parsers.ts` and imported by `CsvUploader.tsx` and `ShapefileUploader.tsx`.
- `CatalogDownloadProgress` & `CatalogSelectionRequest`: Declared in `src/modules/cartography-watcher/types.ts` and imported by `CatalogTreeSelector.tsx`.
- Component props interfaces (`*Props`) remain the only interfaces declared directly within component files.

---

## 4. Code Examples & Diff Snippets

### Before: Opaque File Fetching
```ts
export async function fetchCatalogFile(
  datasetSlug: string,
  resourceId: string,
  fallbackName: string
): Promise<File> {
  const response = await fetch(...);
  return new File([await response.blob()], filename);
}
```

### After: Streaming Fetch with Throttled Progress
```ts
export async function fetchCatalogFile(
  datasetSlug: string,
  resourceId: string,
  fallbackName: string,
  onProgress?: ProgressCallback
): Promise<File> {
  const response = await fetch(...);
  const contentLengthHeader = response.headers.get("Content-Length");
  const totalBytes = contentLengthHeader ? parseInt(contentLengthHeader, 10) : 0;

  if (!response.body) {
    const blob = await response.blob();
    onProgress?.("Descargando archivo...", blob.size, blob.size);
    return new File([blob], filename);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  let lastReportedBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      receivedBytes += value.length;
      if (
        onProgress &&
        (lastReportedBytes === 0 || receivedBytes - lastReportedBytes >= DOWNLOAD_PROGRESS_BYTE_INTERVAL)
      ) {
        onProgress("Descargando archivo...", receivedBytes, totalBytes);
        lastReportedBytes = receivedBytes;
      }
    }
  }

  if (onProgress && receivedBytes > 0) {
    if (totalBytes === 0 || lastReportedBytes < totalBytes || lastReportedBytes === 0) {
      const finalBytes = totalBytes > 0 ? totalBytes : receivedBytes;
      onProgress("Descargando archivo...", finalBytes, finalBytes);
    }
  }

  return new File(chunks as BlobPart[], filename);
}
```

### Chunked Yielding in Parsers
```ts
for (let recordIndex = 0; recordIndex < previewLimit; recordIndex++) {
  if (recordIndex > 0 && recordIndex % PARSE_PROGRESS_CHUNK_SIZE === 0) {
    onProgress?.("Extrayendo geometrías...", recordIndex, previewLimit);
    // react-doctor-disable-next-line react-doctor/async-await-in-loop
    await yieldToMainThread();
  }
  // Extract geometry and properties...
}
```

---

## 5. Verification & Testing

### Automated Quality Gauntlet
All gates passed cleanly with zero errors and zero warnings:

1. **Module Routes Check**:
   ```bash
   npm run modules:routes:check
   # Output: Generated module routes are up to date (7 route file(s)).
   ```
2. **ESLint**:
   ```bash
   npm run lint
   # Output: 0 errors, 0 warnings.
   ```
3. **Unit Tests (Vitest)**:
   ```bash
   npm test
   # Output: 34 passed test files, 355 passed tests (including mainThreadYield.test.ts, fetchCatalogFile.test.ts throttling and indeterminate progress suite, and extended CsvParser/ShapefileParser progress tests).
   ```
4. **Turbopack Production Build**:
   ```bash
   npm run build
   # Output: Clean build, all 14 static and dynamic routes compiled without errors.
   ```
5. **React Doctor Audit**:
   ```bash
   npm run doctor
   # Output: Score 100 / 100 Great. No issues found!
   ```
6. **Playwright End-to-End Suite**:
   ```bash
   npm run test:e2e
   # Output: 23 passed (23.2s).
   ```
