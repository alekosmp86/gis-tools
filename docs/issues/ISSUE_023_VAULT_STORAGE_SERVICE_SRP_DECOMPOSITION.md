# ISSUE 023: VaultStorageService Single Responsibility Principle (SRP) Decomposition

## 1. Problem Statement
The `VaultStorageService` class was identified as handling multiple distinct responsibilities simultaneously, violating the Single Responsibility Principle (SRP):
1. **Pure String Domain & Path Resolution**: Normalizing names (`sanitizeSlug`) and extracting file extensions/basenames (`resolveResourceFilename`) based on URL structures.
2. **HTTP Network Transport**: Directly performing remote network calls (`fetch`), setting User-Agent headers, evaluating HTTP status codes, and streaming raw bytes from public open-data portals.
3. **Local File System & Vault Repository**: Managing directory hierarchies (`data/vault/<source_slug>/`), persisting binary files, and maintaining JSON sidecar `.meta.json` records.

This coupling made unit testing of local file persistence difficult without mocking network requests, coupled local storage to HTTP transport mechanics, and fragmented portal communication between `CkanPortalClient` and `VaultStorageService`.

## 2. Root Cause Analysis & Technical Details
- In the initial implementation, `VaultStorageService.downloadAndVaultResource()` was created as a convenience method that fetched remote resources and saved them to disk in one step.
- While convenient, this placed HTTP network transport responsibilities directly inside a class whose primary domain is local file storage (`data/vault/`).
- At the same time, deterministic string manipulation logic (`sanitizeSlug`, `resolveResourceFilename`) was embedded inside the service rather than being pure, isolated utility functions.

## 3. Implemented Solution
We decomposed `VaultStorageService` into three clean, focused architectural layers:

1. **Pure Utility Extraction (`src/modules/cartography-watcher/utils/vaultNaming.ts`)**:
   - `sanitizeSlug(raw: string): string`: Pure function for unicode normalization (NFD), accent removal, and alphanumeric underscore conversion.
   - `resolveResourceFilename(resource: CkanResource): string`: Pure function for extracting valid filenames from URLs or falling back to sanitized resource names with appropriate extensions.
   - `VaultStorageService` delegates to these utilities for full backward compatibility.

2. **Unified HTTP Transport in `CkanPortalClient` (`src/modules/cartography-watcher/services/CkanPortalClient.ts`)**:
   - Added `downloadResourceBinary(url: string): Promise<Buffer>`.
   - All network communication with external CKAN portals and open-data servers is now centralized in `CkanPortalClient`.

3. **Strict Local Storage Scope for `VaultStorageService` (`src/modules/cartography-watcher/services/VaultStorageService.ts`)**:
   - Removed all `fetch()` calls, network headers, and HTTP logic.
   - Added `saveVaultResource(sourceSlug: string, resource: CkanResource, content: Buffer): Promise<VaultResourceMeta>`.
   - `VaultStorageService` is now a pure filesystem repository: it receives an in-memory `Buffer`, writes it to disk, and updates the `.meta.json` sidecar.

4. **Orchestration in `WatcherOrchestrator` (`src/modules/cartography-watcher/services/WatcherOrchestrator.ts`)**:
   - `downloadResource()` orchestrates the flow:
     1. Fetches binary buffer via `client.downloadResourceBinary(resource.url)`.
     2. Persists to disk via `vault.saveVaultResource(datasetSlug, resource, content)`.
     3. Computes updated delta via `client.evaluateResourceDelta(resource, savedMeta)`.

## 4. Code Examples & Diff Snippets

### Before: VaultStorageService Juggling Network and Storage
```typescript
// VaultStorageService.ts (violating SRP)
public async downloadAndVaultResource(sourceSlug: string, resource: CkanResource) {
  const response = await fetch(resource.url, { headers: { "User-Agent": "..." } });
  if (!response.ok) throw new Error(...);
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.promises.writeFile(targetFilePath, buffer);
  // ...
}
```

### After: Clear Separation of Concerns
```typescript
// CkanPortalClient.ts (Network I/O)
public async downloadResourceBinary(url: string): Promise<Buffer> {
  const response = await fetch(url, { headers: { "User-Agent": "..." } });
  if (!response.ok) throw new Error(...);
  return Buffer.from(await response.arrayBuffer());
}

// VaultStorageService.ts (Disk Persistence only)
public async saveVaultResource(sourceSlug: string, resource: CkanResource, content: Buffer): Promise<VaultResourceMeta> {
  await fs.promises.writeFile(targetFilePath, content);
  await fs.promises.writeFile(metaFilePath, JSON.stringify(metaData, null, 2), "utf-8");
  return metaData;
}

// WatcherOrchestrator.ts (High-Level Orchestration)
const content = await this.client.downloadResourceBinary(resource.url);
const savedMeta = await this.vault.saveVaultResource(datasetSlug, resource, content);
const updatedDelta = this.client.evaluateResourceDelta(resource, savedMeta);
```

## 5. Verification & Testing
- **React Doctor**: Perfect **100 / 100 Great** score (185 files scanned, 0 issues detected).
- **ESLint**: Clean exit code 0 (0 errors, 0 warnings).
- **Unit Tests**:
  - `tests/unit/modules/cartography-watcher/vaultNaming.test.ts`: Tests pure slug sanitization and filename resolution across happy paths and edge cases.
  - `tests/unit/modules/cartography-watcher/VaultStorageService.test.ts`: Verifies local persistence, sidecar creation, cache checks, and file reading without any network dependencies.
  - `tests/unit/modules/cartography-watcher/WatcherOrchestrator.test.ts`: Verifies orchestration between client binary downloading and vault persistence.
