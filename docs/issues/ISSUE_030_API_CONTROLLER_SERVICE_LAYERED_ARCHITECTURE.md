# Issue 030: API Controller & Service 2-Tier Layered Architecture

## 1. Problem Statement
The module API route handler (`src/modules/cartography-watcher/api/route.ts`) had accumulated 161 lines of procedural code. Lines 18–126 contained 6 loose asynchronous handler functions (`handleCatalogTree`, `handleCatalogFile`, `handleSummaries`, `handleCheckSource`, `handlePostSummaries`, `handleDownloadResource`) combining HTTP parameter parsing, business defaults, fallback logic, MIME-type mapping, and header crafting in the route file. This violated layered architecture principles, hindered unit testability, and cluttered the routing entry point.

## 2. Root Cause Analysis & Technical Details
- **Mixed Layer Responsibilities**: In Next.js App Router, `route.ts` is intended solely as the transport endpoint. Procedural handler functions embedded directly in the file blurred HTTP transport concerns with orchestration logic.
- **Architectural Fit**: Because this module integrates with external open data portals (CKAN) and local disk vault storage rather than an internal relational database or ORM/DAO repository, a 3-tier or 4-tier pattern (which introduces unnecessary DAO layers) is redundant. A clean **2-tier layered architecture (Controller + Service)** provides optimal separation of concerns:
  1. **Controller Layer**: HTTP protocol adaptation, parameter parsing, status code handling, and response serialization.
  2. **Service Layer**: Business logic, data retrieval, delta evaluations, and vault coordination without any HTTP dependencies.

## 3. Implemented Solution
1. **Created Controller Layer (`CartographyWatcherController.ts`)**:
   - Encapsulated all HTTP transport actions in `src/modules/cartography-watcher/controllers/CartographyWatcherController.ts`.
   - Injected `WatcherOrchestrator` via constructor dependency injection for hermetic testability.
   - Handled parameter extraction, HTTP status codes (`400 Bad Request`, `404 Not Found`, `500 Internal Server Error`), MIME type resolution via `resolveFileContentType`, and binary file response streaming.
2. **Streamlined Routing Entry Point (`route.ts`)**:
   - Reduced `src/modules/cartography-watcher/api/route.ts` to a lean 18-line entry point that instantiates the controller and delegates `GET` and `POST` requests.
3. **Preserved Pure Service Layer (`WatcherOrchestrator.ts`)**:
   - Maintained `WatcherOrchestrator` as the pure service layer, completely free of HTTP objects (`NextResponse`, `Request`, `URLSearchParams`).

## 4. Code Examples & Diff Snippets

### Before (`src/modules/cartography-watcher/api/route.ts` with 161 lines of loose procedural functions):
```ts
const orchestrator = new WatcherOrchestrator();

async function handleCatalogTree(searchParams: URLSearchParams, watcher: WatcherOrchestrator): Promise<Response> { ... }
async function handleCatalogFile(searchParams: URLSearchParams, watcher: WatcherOrchestrator): Promise<Response> { ... }
async function handleSummaries(searchParams: URLSearchParams, watcher: WatcherOrchestrator): Promise<Response> { ... }
async function handleCheckSource(searchParams: URLSearchParams, watcher: WatcherOrchestrator): Promise<Response> { ... }
async function handlePostSummaries(sources: readonly WatchedSourceConfig[] | undefined, watcher: WatcherOrchestrator): Promise<Response> { ... }
async function handleDownloadResource(sourceUrl: string | undefined, resourceId: string | undefined, watcher: WatcherOrchestrator): Promise<Response> { ... }

export async function GET(request: Request): Promise<Response> { ... }
export async function POST(request: Request): Promise<Response> { ... }
```

### After (`src/modules/cartography-watcher/controllers/CartographyWatcherController.ts`):
```ts
export class CartographyWatcherController {
  constructor(
    private readonly service: WatcherOrchestrator = new WatcherOrchestrator()
  ) {}

  public async handleGet(request: Request): Promise<Response> { ... }
  public async handlePost(request: Request): Promise<Response> { ... }
  public async getCatalogTree(searchParams: URLSearchParams): Promise<Response> { ... }
  public async getCatalogFile(searchParams: URLSearchParams): Promise<Response> { ... }
  public async getSummaries(searchParams: URLSearchParams): Promise<Response> { ... }
  public async checkSource(searchParams: URLSearchParams): Promise<Response> { ... }
  public async postSummaries(sources?: readonly WatchedSourceConfig[]): Promise<Response> { ... }
  public async downloadResource(sourceUrl?: string, resourceId?: string): Promise<Response> { ... }
}
```

### After (`src/modules/cartography-watcher/api/route.ts`):
```ts
import {
  CartographyWatcherController,
  type CartographyWatcherRequestBody,
} from "../controllers/CartographyWatcherController";

export type { CartographyWatcherRequestBody };

const controller = new CartographyWatcherController();

export async function GET(request: Request): Promise<Response> {
  return controller.handleGet(request);
}

export async function POST(request: Request): Promise<Response> {
  return controller.handlePost(request);
}
```

## 5. Verification & Testing
- `npm run lint`: Exited 0 with 0 errors and 0 warnings.
- `npm run doctor`: 0 issues found across 207 scanned files.
- `npm run build`: Next.js Turbopack production build succeeded cleanly in 646ms.
