# Mission — a Playwright safety net for the God-component work

> Previous mission (edit a watched source) merged to `main` at `99857a3`. The hydration-mismatch
> brief was dropped by the user and is archived out of tree.

**Branch**: `test/ui-characterization`, cut from `main`.
**Note**: `npm` is not on PATH — prepend `C:\Alekos\Tools\node24portable` per
`.agents/rules/portable_node.md`.

## Why this mission exists

The real target is the God components. This mission does **not** touch them. It builds the net that
makes touching them safe, because right now there isn't one.

`tests/unit/` holds 30 files and **not one tests a `.tsx`** — `vitest.config.ts` is
`environment: "node"` with `include: ["tests/unit/**/*.test.ts"]`, so a component test would not
even be collected. The only UI coverage is `tests/e2e/smoke.test.ts`, which asserts the home page
has a title. The components slated for refactor — three production sync tools and the view they
share — have **zero** automated coverage.

The watcher refactor was safe because 313 tests pinned it. This one has nothing.

## Binding decisions

**D1 — no component refactor lands before its characterization tests do.** Not negotiable; it is the
whole point of this mission.

**D2 — Playwright, not Testing Library.** Characterization tests exist to survive a refactor.
Testing Library binds to component boundaries, which is precisely what the coming refactors move —
such tests would break *because* of the refactor and prove nothing. Playwright drives the app from
outside: extract a wizard shell or decompose a view and the test does not notice. Playwright is
already a devDependency (`@playwright/test`), so this adds **zero new dependencies** and keeps one
runner instead of two. Do **not** add `@testing-library/*` or `jsdom`.

**D3 — no database. Intercept every API call.** The full surface the UI touches is:

```
/api/db/columns          /api/db/execute      /api/db/records/stream    /api/db/test
/api/m/cartography-watcher/{sources,summaries,catalog,sources/remove,sources/update}
```

Fulfil all of it with `page.route()` fixtures. A test that needs a live PostGIS is not a test we can
run. Put fixtures in `tests/e2e/fixtures/` and the routing helper in `tests/e2e/support/`, so one
helper call arms a page with a coherent fake backend.

**D4 — characterization, not aspiration.** Assert what the app does **today**, including behaviour
you believe is wrong. Their job is to fail if a refactor changes observable behaviour. If you find a
bug while writing them, encode current behaviour and report the bug in `TO_ORCHESTRATOR.md`.
**Do not fix it in this mission.**

**D5 — `SqlPatchGenerator.ts` is NOT a target**, despite being the largest file at 389 lines. I read
it: 15 single-purpose private methods averaging ~25 lines with the public entries acting as
orchestrators — exactly what `AGENTS.md:80-82` asks for, and already covered by
`tests/unit/workers/comparison/SqlPatchGenerator.test.ts`. Size is not the defect. The same holds
for `EwkbGeometryParser`, `BinaryShpReader`, `GisEncodingNormalizer` and `CsvParser`.

## Work

### 1. Harness

- Keep `testDir: "./tests/e2e"`. Organise as `tests/e2e/flows/`, `tests/e2e/fixtures/`,
  `tests/e2e/support/`. Leave `smoke.test.ts` where it is.
- Build the routing helper in `tests/e2e/support/` — something like
  `await mockBackend(page, { columns, records, summaries })` — defaulting every endpoint in D3 to a
  sane fixture so a test only overrides what it cares about.
- **Add a console-error guard** to the shared setup: fail a test if the page emits a `console.error`
  or a `pageerror`, with an opt-out for tests that assert an error path. React hydration mismatches
  and unhandled rejections surface as `console.error`, so this turns a whole class of defect into a
  test failure for free.
- `playwright.config.ts` currently sets `reuseExistingServer: true` unconditionally. That is right
  for local runs against the dev server on port 3000 — **keep that behaviour** — but change it to
  `!process.env.CI` so CI always starts a clean server instead of trusting whatever is listening.

### 2. Characterization flows — `tests/e2e/flows/`

Assert observable behaviour through the DOM and real user events. Prefer role- and text-based
locators over CSS classes: class names are exactly what a refactor changes.

**The three sync wizards** — `src/app/tools/db-csv-sync/page.tsx` (172 lines),
`db-shapefile-sync/page.tsx` (171), `db-db-sync/page.tsx` (194). They share 11 of ~13 imports and
each holds 9-11 hooks driving the same connect → upload → map SUIDs → parameters → results flow.
One spec per tool covering: initial step, advancing on valid input, the guard that blocks advancing
on invalid input, and going back. **These three specs are what make the shared-shell extraction
safe**, so assert the *flow and its guards*, not the markup.

**`ComparisonResultsView`** (`src/components/tools/db-sync-common/ComparisonResultsView.tsx`, 177
lines, **16 imports — the highest fan-out in the repo**). Reached through a sync wizard with fixture
data. Cover: default tab, switching tabs, a filter changing which discrepancies are listed, the
loading and error states, and that requesting SQL patches produces the patch output.

**Cartography watcher** (`/tools/m/cartography-watcher`). Cover: the catalogue tree selecting and
expanding, the format filter, adding a source, and — the contract deferred from the watcher review —
**editing a source when the server rejects the update: the form must stay open, keep the typed URL,
and show the server's Spanish message inside the card.** Arm it by routing
`/api/m/cartography-watcher/sources/update` to a failure response. That behaviour currently survives
only on the ordering of two lines and a comment at `WatchedSourceCard.tsx:52-56`.

### 3. Scripts and documentation

- Make sure `npm run test:e2e` runs the new specs. If a headed/debug variant helps, add it as a
  separate script rather than changing the default.
- **Fix the stale Vitest coverage globs while you are here** — independent of Playwright, but real:
  `coverage.include` in `vitest.config.ts` reads `["src/utils/**", "src/services/**",
  "src/workers/**"]` and **none of those directories exist**. The real paths are
  `src/core/services/**` and `src/core/workers/**`; `src/utils` never existed. `npm run test:coverage`
  is measuring nothing today. Point it at real directories and add `src/core/**`.
- Add `tests/e2e/README.md`: what belongs here versus `tests/unit/`, that these are characterization
  tests protecting refactors, the fixture/routing convention, and the rule that they assert current
  behaviour. Add a pointer to it from the testing section of `AGENTS.md`.

## Out of scope

- **Any refactor of any component.** Tests, fixtures and config only.
- Fixing bugs the tests reveal (D4 — report them).
- `SqlPatchGenerator` and the other large-but-cohesive core files (D5).
- Testing Library, jsdom, or a second test runner (D2).
- The hydration mismatch. Dropped by the user — though if the console-error guard catches it, say so
  in your report.

## What comes next — context, not scope

1. **Extract the shared sync-wizard shell.** ~540 lines expressing one flow three times, differing
   only in the uploader and the file-type types. Largest genuine duplication in the repo.
2. **Decompose `ComparisonResultsView`** — separate view orchestration from worker invocation and
   tab/filter state.

Neither starts until this mission is green.

## Definition of done

Gauntlet green with real output pasted into `.agents/handoff/TO_ORCHESTRATOR.md`:
`modules:routes:check`, `lint`, `test`, `build`, `doctor` — **plus `test:e2e`**, which is the point
of this mission.

The 313 existing unit tests must all still pass, unchanged — **no assertion may be altered**. Report
the Playwright spec count and per-flow pass/fail. Paste the `test:coverage` summary now that it
points at real directories.

If a flow proves untestable without a live database despite D3, stop and report which endpoint and
why — do not weaken the test or introduce a DB dependency.

Do not commit.

---

# Fix round 1 — close the coverage gaps

Round 1 of 3. The orchestrator re-ran every gate independently and all six are green:
routes ✅, lint ✅, 313 unit tests ✅ (`git diff main -- tests/unit` is empty — byte-identical),
build ✅, doctor 100/100 ✅, `test:e2e` 18/18 in 17.1s ✅. Scope discipline verified: **zero bytes
changed under `src/`**, zero new dependencies.

The structure is sound and nothing here needs unpicking. **Every fix below is additive — no
assertion currently in the suite may be changed or removed.**

## The theme

A characterization suite is judged on one thing: would it notice a regression? Three places it
would not. The rest are locators that would break for the wrong reason, or assertions that pass
without proving anything.

## G1 [MAJOR] — step 5 is unprotected in two of the three wizards

`tests/e2e/flows/db-csv-sync.spec.ts:137-139` and `db-db-sync.spec.ts:130-132` assert step 5 only
by its heading. That heading comes from `activeStep.cardTitle` and is rendered **unconditionally**
by `WizardOrchestrator.tsx:50-52`, in a different DOM node from `activeStep.content`
(`WizardOrchestrator.tsx:58-60`). The actual payload is gated:
`content: dbConfig && csvDataset && mappingConfig ? <ComparisonResultsView .../> : null`
(`db-csv-sync/page.tsx:163`).

> The shared-shell extraction rebuilds the step array and loses `mappingConfig` — or passes the
> wrong `descriptor`, or drops `sourceDbConfig` in the DB→DB case. Step 5 renders an **empty card**.
> Both specs pass. Two of the three tools this mission exists to protect are blind at the one step
> that carries the payload.

Only the shapefile path is covered today, and only because `comparison-results.spec.ts` drives it.

Add one content assertion after the heading in both specs, proving the view mounted — e.g.
`await expect(page.getByRole("button", { name: /Total Evaluados/i })).toBeVisible();`.

## G2 [MAJOR] — the loading state was required and is missing

The brief asked for "the loading **and** error states". Only the error state exists.
`ComparisonResultsView.tsx:73-97` has three top-level branches — `loading` (with a `showProgress`
sub-branch driving `ProgressBar`), `errorMessage`, and `summary`. The decomposition will move all
three; two are pinned.

> The decomposition extracts a loading view and inverts
> `showProgress = loading && progress.phase !== ""`, or drops the `onProgress` wiring from
> `useDatasetComparison`. Users stare at a frozen blank panel for the whole PostGIS fetch on a
> 500k-row table. Suite green.

Add a fifth test to `comparison-results.spec.ts`: route `/api/db/records/stream` through a
**deferred** fulfil — hold the route handler on a promise the test resolves — assert
`Consultando registros PostGIS...` or the progress bar is visible, then release and assert the
summary appears. No `waitForTimeout`.

## G3 [MAJOR] — `mockBackend()` is a 295-line monolith with the same ternary pasted eight times

`tests/e2e/support/mockBackend.ts:41-295` registers ten routes inline, repeating
`typeof options.X === "function" ? options.X(body) : options.X ? options.X : DEFAULT` throughout
(12 `typeof options.` sites). `AGENTS.md:81-83` and `code_review_standards.md` §2 bind test code
too, and this is the shared harness every spec depends on.

One of those copies is already incoherent: `watcherRemove`'s function branch does
`resp?.sources ? resp : { success: true, sources: resp }` — the fallback wraps the whole
`{success, sources}` envelope *as* `sources`. It is dead only because no test passes `watcherRemove`
yet.

Extract `resolveOverride(override, arg, fallback)` and a per-endpoint registration array
(`{ pattern, handler }`), reducing `mockBackend` to a loop. Fix or delete the `watcherRemove`
branch. Same behaviour, better factored — **do not change what any endpoint returns.**

Preserve two things exactly: route precedence (the later `**/catalog**` registration must still win
and `fallback()` pathnames containing `/catalog/file`), and the per-`page` `currentSources` closure.

## G4 [MINOR] — a tab assertion that passes whether or not the tab switched

`comparison-results.spec.ts:123-129`. `SqlPatchDrawer.tsx:110-122` renders **both** preview boxes
always, hiding the inactive one with `display: none !important`. `toContainText` matches
`textContent` regardless of visibility, so those lines pass even if `insertTab.click()` did nothing.
`.nth(1)` also binds to render order.

> `useSqlPatchDrawerState`'s `handleTabChange` breaks, the INSERT preview never becomes visible,
> test stays green. Or: someone swaps the render order of the two preview boxes — a legitimate
> behaviour-preserving change — and the test fails for the wrong reason.

Use `page.locator("pre").filter({ hasText: "INSERT INTO" })` with an explicit `toBeVisible()` after
the click. The outer Tabla/SQL tab switch is already correct — leave it.

## G5 [MINOR] — locators that break for the wrong reason

- `comparison-results.spec.ts:35-36` — `page.locator("label").filter({ hasText: "departamento" })`
  is a substring match over every `<label>` on the page. Adding a column to
  `DEFAULT_DB_COLUMNS_RESPONSE` resolves two elements and kills every test in the file on a
  strict-mode violation unrelated to any behaviour change. Use
  `getByRole("checkbox", { name: "...", exact: true })`.
- `cartography-watcher.spec.ts:61` — `page.locator("article")`. Use `getByRole("article")`.
- `cartography-watcher.spec.ts:68` — `card.locator('input[type="text"]')` breaks the moment
  `EditSourceForm` gains a second field. The input already has a `useId`-bound label
  (`EditSourceForm.tsx:45-49`): use `card.getByLabel("URL o identificador del catálogo")`.

## G6 [MINOR] — three assertions that test the mock, not the app

- **Catalogue filter** (`cartography-watcher.spec.ts:118-125`): only presence of the CSV resource is
  asserted. A *wrong* filter is caught; a *missing* one is not. If `resolveCatalogFilter`
  (`CatalogTreeSelector.tsx:33-35`) stops being passed, the mock returns every group and a shapefile
  appears inside the CSV wizard — test passes. Add
  `await expect(page.getByRole("button", { name: /parcelas_montevideo\.zip/i })).toHaveCount(0);`.
- **Add a source** (`cartography-watcher.spec.ts:26-37`, mock at `mockBackend.ts:194-212`): the POST
  handler ignores `route.request().postDataJSON()` and always returns `"Nueva Fuente Añadida"`. If
  `AddSourceForm` stopped sending the typed URL the test would still pass. Derive
  `title`/`datasetSlug` from `body.url` and assert the derived value.
- **The wizard-remount quirk**: `TO_ORCHESTRATOR.md:94` claims it is "captured and verified in
  backward navigation flows for all 3 sync tools". It is not — the specs re-fill and re-connect,
  which is a workaround, and no assertion depends on the quirk. Either pin current behaviour (after
  "Volver al Paso 1", assert "Continuar al Paso 2" is enabled *and* that clicking it leaves the
  step-1 heading visible) or correct the claim. **Do not report a workaround as coverage.**

## G7 [MINOR] — `smoke.test.ts` makes a real outbound network call

It imports raw `@playwright/test`, so it gets neither `mockBackend` nor the console guard. `/`
mounts `WatcherHomeCard`, which fires `fetchSummaries()` → the real CKAN portal at
`catalogodatos.gub.uy`. That violates **D3** and `testing_standards.md`. Import from
`../support/testFixture` and call `await mockBackend()`.

While there: make the title assertion exact —
`toHaveTitle("Suite de Herramientas SIG | Procesamiento Espacial")`. The `(Herramientas SIG|GIS
Tools)` alternation has a dead branch that can never match, and its presence disguises the fact that
the original assertion was broken.

## G8 [MINOR] — `MockBackendOptions` types are non-types

`mockBackend.ts:15-35`: `columns?: unknown | ((body) => unknown)` collapses to `unknown`. This is
the shared harness, and compile-time typing is the only automated defence against fixtures drifting
from the real API contracts. Type them against the real shapes (`typeof DEFAULT_DB_COLUMNS_RESPONSE`,
`SourceSummary[]`, `CatalogSourceGroup[]`).

## G9 [NIT] — fold in only if you are already in the file

- The 8-line "connect to DB" preamble appears seven times across four specs. A
  `support/wizardSteps.ts` with `connectDb(page, config)` removes it without hiding intent.
- `eslint.config.mjs:92-99` disables `react-hooks/rules-of-hooks` for all of `tests/**`. The
  justification is genuine but the scope exceeds the cause — narrow to `tests/e2e/support/**`.
- `playwright.config.ts` has no explicit `timeout`, so 30s per test. CI now cold-starts the dev
  server, and the first test hitting each of the four routes pays Turbopack's on-demand compile
  inside that budget. Set `timeout: 60_000` pre-emptively.

## Also — one dependency decision, mine not yours

`npm run test:coverage` fails outright: `@vitest/coverage-v8` is not installed. You were right to
disclose it and right not to add a dependency under D2. **I am authorising it now**: add
`@vitest/coverage-v8` as a devDependency, matching the installed Vitest major, and paste the
coverage summary in your report. The globs are correct but unrunnable, which is worse than either
extreme.

## Rejected — do not implement

- **Collapsing the duplication between `db-csv-sync.spec.ts` and `db-shapefile-sync.spec.ts`.** The
  two specs are near-identical, and that is correct: they mirror the production duplication these
  tests exist to make removable. Coupling them now would bind the three specs to each other
  immediately before the refactor that must be free to change them independently. Leave them
  duplicated. This is on the record so no later round "fixes" it.
- **Adding `src/components/**`, `src/ui-kit/**` or `src/modules/**` to the Vitest coverage globs.**
  `["src/core/**"]` is correct as delivered. Vitest never collects a `.tsx` here, so those trees
  would report a hard 0% and bury the real signal. UI coverage lives in Playwright now.
- **A firefox Playwright project.** The dropped hydration bug was Firefox-only and chromium-only
  runs will not see it. Out of scope for this mission; raise it separately if we return to that bug.

## Definition of done

All six gates green again with real output pasted, **including `test:e2e`** and now
`test:coverage`. The 313 unit tests must remain byte-identical. Playwright spec count may only go up
from 18. Report per id (G1-G9) and state plainly anything not done and why.

Do not commit.

---

# Fix round 2 — make the assertions load-bearing

Round 2 of 3. All eight gates re-run independently by the orchestrator and green: routes ✅,
lint ✅, 313 unit tests ✅ (`git diff main -- tests/unit` empty), build ✅, doctor 100/100 ✅,
`test:e2e` 19/19 ✅, and `test:coverage` now runs (37.67% stmts on `src/core`). Scope discipline
verified again: **zero bytes under `src/`**, exactly the one authorised devDependency.

Two independent reviewers with fresh context read this branch. They agreed the infrastructure is
sound — contract-faithful mocks, a console guard that genuinely fails tests, real comparison-engine
execution rather than stubs, no hard waits or ordering dependencies. **G1-G9 all landed.**

They disagreed on the suite's efficacy, and the harsher one is right. The theme of this round: an
assertion that only ever checks the *positive* half of a mutually-exclusive state cannot fail when
that exclusivity breaks. Everything below is **additive** — no existing assertion may be removed or
weakened.

## Two of these are my fault, not yours

**H1 and H5 exist because I specified them loosely.** You implemented what the brief said. I am
correcting the instruction, not the execution.

## H1 [MAJOR] — tab mutual exclusion is never asserted

`ComparisonResultsView.tsx:120, 132, 150` keeps all three panels mounted and toggles them with
`styles.tabHidden` (`display: none !important`, `ComparisonResultsView.module.css:124`).
`SqlPatchDrawer.tsx:113` does the same for its two `<pre>` previews. The suite contains **zero**
`toBeHidden()` or `not.toBeVisible()` assertions — every tab test checks only that the newly
selected panel appears.

> The decomposition extracts the three panel wrappers into a `<ResultsTabPanels>` and loses one
> conditional, or inverts `!isUpdateTab`. The user sees the discrepancies table and the SQL script
> **stacked on top of each other**, or both UPDATE and INSERT previews at once. Every assertion
> still passes.

Add the negative half at each switch in `comparison-results.spec.ts`: after the table assertion,
`await expect(page.getByRole("table")).toBeHidden()` once SQL is active; after `updatePre` is
visible, `await expect(insertPre).toBeHidden()`; and the converse. `toBeHidden()` works here
precisely because `display: none` removes the node from the accessibility tree.

## H2 [MAJOR] — the map tab and its whole subtree are unreached

`hasGeojson` is true in the shapefile flow, so `ResultsControlsBar.tsx:34-43` renders a third tab,
"Mapa de Discrepancias Espaciales". **No spec clicks it** — test 3 deliberately routes
Table → SQL → Table around it. That leaves `useDiscrepancyGeojson`, the lazy `isMapActive`
evaluation, the `dynamic(..., { ssr: false })` `SpatialMapPreview` import, `maxFeatures={null}` and
the "No se encontraron discrepancias para el filtro seleccionado." empty state all uncovered.

> The decomposition moves the map block into an extracted panel and drops
> `isVisible={activeViewTab === ResultsViewTab.MAP}`, or breaks the
> `hasGeojson && discrepancyGeojson` guard. The map renders blank or the dynamic import throws on
> mount. No test visits the path, so **even the console guard never fires.**

Add a test: click the map tab, assert the map container is visible and the table hidden, then apply
a KPI filter yielding no spatial features and assert the empty-state message.

## H3 [MAJOR] — step-indicator back-navigation is unreached

`StepIndicator.tsx:23, 37-40` conditionally applies `role="button"`, `tabIndex`, `onClick` and
`onKeyDown` for steps behind the current one, wired through `handleStepClick` (`page.tsx:66-70` in
all three wizards). All five specs navigate **exclusively** via footer buttons; `onStepClick` is
never exercised anywhere.

> The shell extraction stops threading `onStepClick` down to `StepIndicator` — an easy omission
> across two levels. Every step loses its role, focusability and click handler; users can no longer
> jump back via the stepper. Nothing fails. Worse: invert the guard to `step.id > currentStep` and a
> user jumps to step 5 with `dbConfig === null`, `ComparisonResultsView` renders `null`, the wizard
> looks broken — still nothing fails.

In one wizard spec: from step 3, click the "PASO 1" stepper entry and assert step 1's heading; then
assert the step-4 and step-5 entries do **not** expose `role="button"` while on step 3.

## H4 [MAJOR] — `db-csv-sync` and `db-db-sync` still assert no comparison outcome

My G1 asked for proof the view mounted, and `getByRole("button", { name: /Total Evaluados/i })`
delivers exactly that — but no more. That card renders whenever `summary && !loading`; its *value*
is never asserted, no other KPI is, no table row is, and no descriptor-derived label is. Only
`comparison-results.spec.ts` asserts real content, and it runs solely against the shapefile tool.

> **(a)** The extraction breaks `dbColumns`/`columnDetails` threading into `SuidMappingStep`
> (`db-csv-sync/page.tsx:118-119`). Default SUID auto-selection picks nothing, the comparison yields
> 0 matches and 6 spurious discrepancies. `Total Evaluados` is still on screen. Green.
> **(b)** The extraction swaps or drops the `descriptor` prop (`DB_VS_CSV_DESCRIPTOR` at
> `db-csv-sync/page.tsx:168`, `DB_VS_DB_DESCRIPTOR` at `db-db-sync/page.tsx:187`). Every KPI title
> and two of five column headers silently change — the DB-DB tool starts calling its two databases
> "Base de Datos" and "Archivo Shapefile". Green, because `resolveComparisonDescriptor` falls back
> rather than throwing.

In each of the two specs assert one **descriptor-specific** KPI title (`"Solo en Archivo CSV"` /
`"Solo en DB Origen"`) and one concrete row — for CSV, `getByRole("cell", { name: "PAD-002" })`,
which the fixtures do produce.

Note also: `comparison-results.spec.ts:64` uses `/Solo en Archivo/i`, which matches both
`"Solo en Archivo CSV"` and `"Solo en Archivo Shapefile"` — tighten it to the exact descriptor text.

Separately, `db-db-sync.spec.ts` feeds the **identical** `buildNdjsonStream()` to both databases, so
the DB-vs-DB comparison is degenerate — zero discrepancies by construction. Override `recordsStream`
per `table_name` so the target differs from the source.

## H5 [MAJOR] — the loading assertion cannot fail on the regression it was written for

`comparison-results.spec.ts:186-188` asserts
`getByText(/Conectando a base de datos PostgreSQL|Consultando registros PostGIS/i)`. Those are the
**two sibling branches of one ternary** (`ComparisonResultsView.tsx:75-90`:
`showProgress ? <ProgressBar/> : <Loader2/> + "Consultando registros PostGIS..."`). Exactly one
always renders while `loading` is true, so the alternation proves only that *some* loading state
exists.

> The decomposition extracts a loading view and forgets to thread `progress`, so `phase` is `""`.
> The progress bar silently disappears and users get an indefinite spinner on a 500k-row query. The
> test titled "debe mostrar el estado de carga" passes on the other alternative.

Both reviewers found this independently. Assert the branch that actually renders — the phase string
comes from `DatabaseStreamReader.ts:44`, so `ProgressBar` is deterministic here — and drop the
alternation: `await expect(page.getByText("Conectando a base de datos PostgreSQL...")).toBeVisible()`
plus a percentage or `registros` counter assertion.

## H6 [MINOR] — assertions that check a label rather than a value

- **Watcher dashboard** (`cartography-watcher.spec.ts:21-23`): the test is titled "...y sus estados"
  but asserts only the hardcoded `<dt>` labels `Recursos`/`Novedades`/`Última consulta`, which
  render unconditionally from `summary ? … : "—"`. Refactor `indexSummariesBySourceId`
  (`WatcherDashboard.tsx:32-36`) to key by `datasetSlug` and every card loses its summary — badge
  reads "Consultando...", all metrics "—" — and every assertion still passes. Assert the **values**
  (`"4"`, `"Sin novedades"`, `"1 archivo pendiente"`) and both `SourceStatusBadge` states. That also
  removes the `.first()` calls, which currently mask a genuine multi-match ("Novedades" is a
  substring of "Sin novedades").
- **Add a source** (`mockBackend.ts:205-216`, asserted at `cartography-watcher.spec.ts:36`): the
  mock re-derives the slug from `/dataset/<slug>` — logic the app owns in `domain/sourceNaming.ts` —
  and the spec asserts the mock's own output round-tripped through the DOM. Return a fixed title
  from the mock and assert that, so the assertion is unambiguously about rendering.

## H7 [MINOR] — untested paths behind unused mock options

Nine of thirteen `MockBackendOptions` are referenced by no spec. Two of those gaps matter for the
coming refactor:

- `execute`/`executeStatus`: `SqlPatchExecuteButton` → `SqlExecutionModal` → `/api/db/execute` →
  `executedTabs`/`executionResult` feedback is entirely unreached **inside `SqlPatchDrawer`**, which
  the decomposition will touch. Add the happy path: click "Ejecutar en BD", assert the "(Ejecutado)"
  tab marker appears.
- `columnsStatus`: the step-1 connection-failure branch (`useDbConnectionForm.ts:143-147`) is
  unreached. Add a columns-500 test asserting the failure message.

For the remaining options: either use them or delete them. An option no test uses is untested
infrastructure.

## H8 [MINOR] — harness hardening

- **`allowConsoleErrors()` is all-or-nothing** (`testFixture.ts:22-26`). Both call sites need to
  tolerate exactly one thing: Chrome's "Failed to load resource: 400/500". As written it also
  disables `pageerror` and unhandled-rejection detection — so a React error introduced in the
  error-alert render path would be invisible in the one test that renders it. Make it take a
  pattern, `allowConsoleErrors(/Failed to load resource/)`, and keep failing on everything else.
- **Double registration** (`mockBackend.ts:67-69`): `comparison-results.spec.ts:150` and
  `cartography-watcher.spec.ts:48` re-invoke `mockBackend` after `beforeEach` already did, leaving
  twenty handlers live with two divergent `currentSources` closures. Correct today (last
  registration wins) but latent. Call `page.unrouteAll()` first, or accept overrides through a
  single per-test registration.
- **`watcherSources` array override desyncs** (`mockBackend.ts:67-69` and `:227`): the GET handler
  returns the original seed rather than the mutated `currentSources`, so an added or removed source
  would vanish on the next refetch. Latent — no test passes the option yet. Resolve function
  overrides only, and otherwise return `currentSources`.
- **Fixture types are circular** (`mockBackend.ts:15-20`): typed as
  `typeof DEFAULT_WATCHED_SOURCES[number]` — derived from the fixtures themselves, so the check
  proves nothing. G8 asked for the real domain types and they are importable (`@/*` maps to `src/*`,
  and `tests/unit` already does this). Annotate the three constants in `watcherFixtures.ts` as
  `WatchedSource[]`, `SourceSummary[]`, `CatalogSourceGroup[]`. The current bodies already satisfy
  those shapes — annotations only.

## H9 [MINOR] — report corrections

- `TO_ORCHESTRATOR.md:262` cites `src/components/tools/db-sync-common/DbConnectionForm.tsx`. That
  path does not exist; it is `src/ui-kit/components/DbConnectionForm.tsx` with state in
  `src/ui-kit/hooks/useDbConnectionForm.ts`. The substance of the quirk is correct and verified.
- The brief asked you to say whether the console guard caught the dropped hydration mismatch. The
  report is silent, and silence plus a green suite reads as "cleared". It is not: the bug was
  Firefox-only and the config runs a single chromium project, so the run carries no information
  either way. Add that line.
- `TO_ORCHESTRATOR.md:22` calls the fixture types "real contract shapes". They are fixture shapes —
  see H8.

## H10 [NIT]

- `dbFixtures.ts:59` comments `'B2_DIFF'`; the data is `B2_MODIFIED` (`sampleFiles.ts:7`).
- `tests/e2e/README.md:62` says a console error "provoca la falla inmediata del test". It fires in
  teardown, after the body completes. Reword.
- `watcherFixtures.ts:32,41` pin `checkedAt` to today's date. Use a clearly historical one.
- `cartography-watcher.spec.ts:98-102` still inlines the connect preamble that
  `support/wizardSteps.ts:21-26` now encapsulates — 9 of 10 sites migrated.

## Rejected — do not implement

- **Collapsing the three wizard specs into a parameterized helper.** They are ~70% identical and one
  reviewer wants them merged. **No.** They mirror the production duplication these tests exist to
  make removable; coupling them now binds the three specs together immediately before the refactor
  that must change them independently. My round-1 rejection stands.
  **One narrow exception:** the D4 remount-quirk characterization is pasted verbatim three times and
  pins *one shared defect* rather than per-tool behaviour. Extract **only that block** into
  `support/wizardSteps.ts`, commented as a pinned defect, so that when the shell extraction fixes
  the quirk exactly one test goes red and reads as "the bug was fixed" rather than "the refactor
  broke something". Leave the flows themselves duplicated.
- **A firefox Playwright project.** Still out of scope.
- **Switching the webServer to `next build && next start`.** Reasonable for CI eventually; not this
  mission.

## Definition of done

All eight gates green with real output pasted, including `test:e2e` and `test:coverage`. The 313
unit tests must remain byte-identical. Playwright spec count may only go up from 19. Report per id
(H1-H10) and state plainly anything not done and why.

Do not commit.

---

# Mission — extract the shared wizard steps (God-component sweep, target 1 of 2)

> Previous mission (Playwright characterization safety net) merged to `main`. 313 unit tests, 23
> Playwright specs, all green. This mission is the first thing that safety net was built to protect.

**Branch**: `refactor/sync-wizard-shared-steps`, cut from `main`.
**Note**: `npm` is not on PATH — prepend `C:\Alekos\Tools\node24portable` per
`.agents/rules/portable_node.md`.

## Why — and why NOT the other "God" candidates

The orchestrator swept every file in the top 20 by import fan-out (regenerated dependency graph,
193 files / 504 imports / 0 cycles) and read each one's actual structure, not just its size. Full
verdict below. **Only two are real; everything else is a false positive** — high fan-out produced by
good decomposition (a composition root injecting many already-tested, single-purpose collaborators),
not by God-component sprawl. Do not "fix" anything in the false-positive list; that would be
churn against working, well-factored code.

| File | Fan-out / LOC | Verdict | Why |
|---|---|---|---|
| `app/tools/db-{csv,shapefile,db}-sync/page.tsx` | 11-12 / 172-207 | **REAL — this mission** | Steps 3-4-5 of the wizard are near-verbatim duplicated three times |
| `components/tools/db-sync-common/ComparisonResultsView.tsx` | 16 / 177 | **REAL — separate mission, see below** | Genuinely mixes tab state, worker invocation, geojson loading, search state, resync banner |
| `core/workers/comparison/SpatialComparisonEngine.ts` | 13 / 269 | False positive | DI composition root, 8 injected single-purpose collaborators, each independently tested |
| `components/tools/db-csv-sync/CsvUploader.tsx`, `ShapefileUploader.tsx`, `file-viewer/FileViewerUploader.tsx` | 7-12 / 135-196 | False positive | Three siblings of the same shape: drag-drop boilerplate, parsing delegated to a tested parser class |
| `components/tools/db-sync-common/sql-patch-drawer/SqlPatchDrawer.tsx` | 10 / 132 | False positive | Textbook: composes 8 pre-decomposed sub-components, state lives in `useSqlPatchDrawerState` |
| `app/page.tsx` | 10 / 66 | False positive | Thin page composing 7 named atomic components — the *result* of good decomposition, not a symptom of bad |
| `modules/cartography-watcher/manifest.ts` | 8 / 60 | False positive | Purely declarative wiring object, zero logic |
| `modules/cartography-watcher/services/WatcherOrchestrator.ts` | 8 / 256 | False positive | Already reviewed three rounds deep in the prior mission; composition root, ten short methods. Flagged then as "next to split if an 11th operation lands" — still not now |
| `ui-kit/components/SpatialMapPreview.tsx` | 8 / 107 | False positive | Composes 3 sub-components + a dedicated `useLeafletMap` hook |
| `components/tools/db-sync-common/discrepancies-table/DiscrepanciesTable.tsx` | 7 / 64 | False positive | Perfect orchestrator: state in a hook, renders 4 dedicated children |
| `components/tools/db-table-viewer/DbTableViewerContainer.tsx`, `file-viewer/FileViewerContainer.tsx` | 7-8 / 89-110 | False positive | Thin containers delegating to sub-components and hooks |
| `hooks/useDatasetComparison.ts` | 7 / 97 | False positive | Thin React Query hook, actual comparison work delegated to two engine classes |
| `ui-kit/hooks/useDbConnectionForm.ts` | 6 / 209 | **Real but minor — explicitly out of scope, see below** | Mixes connection-form state with saved-profile CRUD (select/save/update/delete + localStorage) |

## The target

Read all three pages in full (`db-csv-sync/page.tsx` 184 lines, `db-shapefile-sync/page.tsx` 183,
`db-db-sync/page.tsx` 207). Finding, precise: **steps 3, 4 and 5 — SUID mapping, sync parameters,
results — are near-verbatim identical across all three pages.** Step 4 (`SyncParametersStep`) is
byte-for-byte identical wiring in every page: same title/subtitle/cardTitle/cardSubtitle/icon, same
`nextLabel`, same `backLabel`, same `onBack`. Step 3 and step 5 differ only in a few interpolated
strings and which page-local state feeds them.

**Steps 1 (and step 2 for db-db) are genuinely different, not duplicated**: CSV/shapefile use
`DbConnectionForm` + a file uploader; db-db uses `DbConnectionForm` twice, wired to two independent
pieces of state, with no upload step at all. Do not force these into a shared abstraction.

## Binding decisions

**D1 — scope is the shared-step extraction only.** `ComparisonResultsView`'s internal decomposition
is a separate, later mission on its own branch, not touched here. The two refactors are independent
files; doing them together doubles the blast radius the moment either one goes wrong, and conflates
two structural changes in front of one review cycle. Sequence: this mission merges and is stable
first.

**D2 — no generic `<SyncWizardShell>` component or hook.** Do not build an abstraction that
parametrizes over step count, uploader type, or "how many sources." Steps 1 and 2 stay hand-written,
per page, exactly as they are today. Forcing db-db's two-DB-connection shape and the other two tools'
one-DB-plus-upload shape into one parametrized shell needs conditional branching that costs more than
the duplication it removes — precisely the over-abstraction `.agents/rules/code_review_standards.md`
§2 warns against. If you find yourself writing a discriminated union or a `hasUpload: boolean` prop,
stop — that is the wrong direction.

**D3 — extract three pure step-factory functions**, not a component, into a new file
`src/components/tools/db-sync-common/wizardSteps.tsx`:

```ts
export function buildSuidMappingStep(params: BuildSuidMappingStepParams): WizardStepDef
export function buildSyncParametersStep(params: BuildSyncParametersStepParams): WizardStepDef
export function buildResultsStep(params: BuildResultsStepParams): WizardStepDef
```

Each is a pure function: given typed params, return a `WizardStepDef` (`src/ui-kit/types/ui.ts:79`).
No React state, no hooks inside the factories — refs, callbacks and already-computed values are
passed in by the page, which still owns all state exactly as it does today. This keeps the factories
trivially testable in isolation later if ever needed, and keeps every page's state ownership
unchanged — only the step *object construction* moves.

**Exact parameter contracts — do not redesign these, copy them:**

```ts
export interface BuildSuidMappingStepParams {
  ref: React.RefObject<SuidMappingStepRef | null>;
  isSourceReady: boolean;           // gates content: csvDataset ? ... : null, etc.
  dbColumns: string[];
  columnDetails?: DbColumnMetadata[];
  fileAttributes: string[];         // "the other side's" attributes — csvDataset.attributes /
                                     // shapefileData.attributes / dbColumns1 for db-db
  initialConfig: ColumnMappingConfig | null;
  showGeometryToggle?: boolean;     // CSV passes true, shapefile omits (defaults true), db-db passes false — preserve exactly
  onReadyChange: (ready: boolean) => void;
  onSuccess: (config: ColumnMappingConfig) => void;
  cardSubtitle: string;             // VARIES — db-db's wording differs from CSV/shapefile's. Pass verbatim per page, do not unify the text.
  onBack: () => void;               // setCurrentStep(2) for CSV/shapefile, setCurrentStep(2) for db-db too — still pass explicitly, do not hardcode
}

export interface BuildSyncParametersStepParams {
  ref: React.RefObject<SyncParametersStepRef | null>;
  dbColumns: string[];
  columnDetails?: DbColumnMetadata[];
  initialConfig: ColumnMappingConfig | null;
  onSuccess: (finalConfig: ColumnMappingConfig) => void;
  onBack: () => void;               // every page does setCurrentStep(3) — pass it anyway, the factory cannot reach page state
}
// title/subtitle/cardTitle/cardSubtitle/icon/nextLabel/backLabel are IDENTICAL in all three pages
// today (verified) — hardcode them inside the factory. Do not add params for these.

export interface BuildResultsStepParams {
  dbConfig: DbConfig | null;
  fileDataset: ParsedShapefileData | ParsedFileDataset | null;
  mappingConfig: ColumnMappingConfig | null;
  sourceDbConfig?: DbConfig;
  descriptor: ComparisonSourceDescriptor;
  cardSubtitleWhenReady: string;    // VARIES — the interpolated "Correlación realizada entre X y Y." text per tool
  onBack: () => void;               // every page does setCurrentStep(4)
}
// cardSubtitleDefault ("Visualice las diferencias detectadas y genere scripts SQL de
// sincronización.") is IDENTICAL in all three — hardcode it. content gating
// (dbConfig && fileDataset && mappingConfig ? <ComparisonResultsView .../> : null) belongs inside
// the factory.
```

**D4 — preserve every user-facing string byte for byte.** Headings, subtitles, button labels — the
Playwright suite asserts many of them literally (`getByRole("heading", { name: "..." })`,
`getByRole("button", { name: "Solo en Archivo CSV" })`, etc.). A single re-wrapped sentence breaks a
test for a reason that has nothing to do with structure. Where a string is confirmed identical across
all three pages (see contracts above), hardcode it in the factory; where it varies, it must arrive as
a parameter, verbatim from the current page source.

**D5 — do not touch `WizardOrchestrator`, `StepIndicator`, or the `key={step-content-${activeStep.id}}`
remount.** That remount is a pinned defect (`useDbConnectionForm` never fires `onStatusChange` on
mount, so the parent's `isDbConnected` survives a step-content remount the child's internal state does
not) with a dedicated Playwright assertion in all three wizard specs
(`support/wizardSteps.ts:assertStep1RemountQuirk`). This mission does not fix it and must not
accidentally remove it by restructuring how step content mounts.

**D6 — the Playwright suite is the acceptance gate, not a formality.** All 23 specs must pass with
**zero assertion changes** — the point of this mission is proving the safety net built for exactly
this refactor actually holds. Import-path changes are fine if a spec imports something that moved;
an assertion text or locator change is not, and signals the refactor altered behaviour.

**D7 — each page keeps its own state, refs and step 1 (and step 2 for db-db) exactly as they are.**
Only the construction of step objects 3/4/5 moves into the shared factories. Do not lift state into
the new file, do not add a fourth abstraction layer.

## Explicitly out of scope

- **`ComparisonResultsView` decomposition.** Real finding, separate mission, sequenced after this one
  merges and is verified stable (D1).
- **`useDbConnectionForm` profile-CRUD split.** Real but minor — the hook mixes connection-form state
  with saved-profile CRUD and localStorage persistence, which are two different concerns. Not a "God
  component" by size or by the user's framing (it is 209 lines with 9 reasonably-sized handlers), and
  unrelated to the wizard-duplication problem this mission solves. Log it; do not touch it here.
- **Any change to `WizardOrchestrator`, `StepIndicator`, or any `ui-kit` component** (D5).
- **Any change to production API routes, handlers, or the comparison engines.**
- **Adding component-test infrastructure.** The Playwright suite already covers this surface — that
  is the entire premise of doing this refactor now rather than earlier.
- **Every false positive in the table above.** Do not "clean up" `SpatialComparisonEngine`,
  `SqlPatchDrawer`, `app/page.tsx`, or anything else in that list. They are not in scope because they
  are not broken.

## Rules that bind this work

`AGENTS.md`, `.agents/rules/coding_guidelines.md`, `.agents/rules/module_authoring.md`,
`.agents/rules/testing_standards.md`, `.agents/rules/code_review_standards.md` (the review that
follows this mission will be judged against §2 — architecture, duplication, over-abstraction —
explicitly, not just correctness).

## Definition of done

Full gauntlet green, real output pasted into `.agents/handoff/TO_ORCHESTRATOR.md`:

```
npm run modules:routes:check
npm run lint
npm test
npm run build
npm run doctor
npm run test:e2e
npm run test:coverage
```

313 unit tests unchanged. **All 23 Playwright specs pass with zero assertion changes** — this is the
literal acceptance criterion, not a nice-to-have. Report the LOC delta on the three page files and
confirm `wizardSteps.tsx` is the only new file. State plainly anything you could not preserve exactly
and why.

Do not commit.

---

# Fix round 1 — narrow the suppression, tighten one contract

The gauntlet re-ran green independently (routes ✅, lint ✅, 313/313 unit tests ✅ — `git diff main --
tests/` empty, build ✅, doctor 100/100 ✅). Two independent reviewers (the orchestrator's own read and
a fresh-context `code-reviewer` subagent) read every line of `wizardSteps.tsx` and all three pages in
full, not just the diff hunks, and cross-checked every hardcoded and interpolated string against
`git show main:...` for each original page. D1, D2, D4, D5, D6, D7 all hold exactly. Both reviewers
independently traced the `hasDatasets`/`cardSubtitleWhenReady` gating in `buildResultsStep` for
`db-db-sync` specifically — `sourceDataset` is derived as `dbConfig1 ? {...} : null`, so it is truthy
iff `dbConfig1` is — and confirmed the factory's `Boolean(params.dbConfig && params.fileDataset)` is a
true logical equivalent of the original page's `dbConfig1 && dbConfig2` subtitle condition, not just a
superficial match. **This is a clean extraction.** Everything below is the one real defect and one
contract tightening — nothing here questions the shape of the refactor itself.

## R1 [MAJOR] — the ESLint suppression is scoped to the wrong boundary

`eslint.config.mjs:100-106` disables `react-hooks/refs` for the glob `src/app/tools/**/*.{ts,tsx}`,
which matches **5 page files** — but only 3 (`db-csv-sync`, `db-db-sync`, `db-shapefile-sync`)
actually pass a `RefObject` into a factory function during render, the one pattern that legitimately
trips this rule. Verified by grep: `db-table-viewer/page.tsx` uses `ref={dbFormRef}` as a JSX prop and
`dbFormRef.current` only inside an event-callback `onNext` — the *safe* pattern the rule is designed
to allow through. `file-viewer/page.tsx` and `m/cartography-watcher/page.tsx` don't reference `.current`
at all. All three match the glob anyway and lose the check for no reason, as would any future file
dropped into `src/app/tools/**`.

> A later change to `db-table-viewer/page.tsx` (or a new tool page) reads `someRef.current` inline
> during render — exactly the bug class `react-hooks/refs` exists to catch, per its own message
> ("Accessing a ref value during render can cause your component not to update as expected").
> `npm run lint` stays green because the rule is off for the whole directory. The regression ships and
> surfaces only as flaky/stale UI state, never as a caught lint error.

**Fix:** Delete the `eslint.config.mjs:100-106` block entirely. Add
`// eslint-disable-next-line react-hooks/refs` immediately above each of the 6 factory call sites
(`buildSuidMappingStep(...)` / `buildSyncParametersStep(...)` in each of the three pages) — the exact
same line those calls already carry for the React Doctor diagnostic
(`// react-doctor-disable-next-line react-hooks-js/refs`). This is not a new pattern: the codebase
already prefers line-level or narrowly-scoped overrides over directory-wide ones (see
`eslint.config.mjs:92-98`, scoped to `tests/e2e/support/**` specifically because that is where the
callback-triggers-rules-of-hooks pattern actually occurs). Do the same here.

This does not reopen D1/D2/D3. `ISSUE_028`'s Option A (container components) and Option B (invert
control, drop `ref` from the factory params) are both real engineering options but solve a bigger
problem than the one that exists — the ref-in-params contract itself is fine, only the suppression's
blast radius is wrong. See Rejected below.

## R2 [MINOR] — `isMappingReady` is an optional param every caller supplies unconditionally

`wizardSteps.tsx:29,71`: `BuildSuidMappingStepParams.isMappingReady?: boolean` with a
`params.isMappingReady ?? true` fallback feeding `canProceed`. All three call sites
(`db-csv-sync/page.tsx:124`, `db-db-sync/page.tsx:142`, `db-shapefile-sync/page.tsx:123`) pass it
every time. An optional field that is always supplied is a weak contract per
`code_review_standards.md` §2 ("optional fields that are always present"): the `?? true` branch is
dead in practice, and a caller that forgets to pass it would silently get `canProceed: true` — a wizard
step advancing when it shouldn't — instead of a type error at the call site.

**This one is mine, not yours.** D3's published parameter contract for `BuildSuidMappingStepParams`
never included a field for `canProceed`'s source at all — an omission in the plan, not a decision you
made. You correctly noticed every page needed `canProceed: isMappingReady` and patched the gap by
adding an optional param. The fix is small: make it `isMappingReady: boolean` (required), drop the
`?? true` fallback, update the three call sites to pass it as already-typed (no behavior change, they
already do).

## Rejected — do not implement

- **`ISSUE_028` Option A (idiomatic container components, e.g. `<SuidMappingStepPanel ref={...} />`)
  and Option B (invert control, remove `ref` from the factory params entirely).** Both are real,
  reasonable designs, and both were on the table pending this review. Rejected for this round: the
  actual defect is an over-broad ESLint glob, not a flaw in D3's ref-in-params contract — R1's
  line-level fix removes the compiler-safety hole with zero architectural change and zero risk to the
  already-verified 23 Playwright specs. Revisit Option A/B only if a future factory needs to hold ref
  logic that a line-level suppression can no longer localize cleanly; not needed here.

## Definition of done

Gauntlet green again, real output pasted: `modules:routes:check`, `lint`, `test`, `build`, `doctor`,
plus `test:e2e` (all 23 specs, zero assertion changes — same acceptance bar as the mission). 313 unit
tests byte-identical. Report per id (R1, R2). State plainly anything not done and why.

Do not commit.

---

# Review round 2 — approved, no findings

Independently re-verified by two readers (the orchestrator, and a fresh-context `code-reviewer`
subagent that ran its own gauntlet): `modules:routes:check` ✅, `lint` ✅ 0/0, `test` ✅ 313/313,
`build` ✅ clean TypeScript + Turbopack, `doctor` ✅ 100/100. `git diff main -- tests/` empty.

**R1 — fully resolved.** `eslint.config.mjs` reverted byte-for-byte to `main` (confirmed empty diff).
All 6 factory call sites carry `// eslint-disable-next-line react-hooks/refs` alongside the existing
`// react-doctor-disable-next-line react-hooks-js/refs`. `db-table-viewer/page.tsx`,
`file-viewer/page.tsx`, and `m/cartography-watcher/page.tsx` are untouched and still covered by the
rule.

**R2 — fully resolved.** `isMappingReady: boolean` is required in `BuildSuidMappingStepParams`;
`canProceed: params.isMappingReady` has no fallback. All three callers already supplied it; build
confirms no caller broke.

No new findings survive from either read — no unused imports, no dead suppression comments, no string
drift introduced by the fix itself. This mission is clean. Next step (branch promotion / commit) is
the user's call, not implied here.

---

# Mission — fix the Luso-letter gap in GisEncodingNormalizer

**Branch**: `fix/gis-encoding-normalizer-luso-letters`, cut from `main`.
**Note**: `npm` is not on PATH — prepend `C:\Alekos\Tools\node24portable` per
`.agents/rules/portable_node.md`.

## The bug

User-reported (screenshot from a live `db-db-sync` run, table `nombre_via`, department RIVERA):
`"EPAMINONDAS MENDONÇA"` (DB) vs `"EPAMINONDAS MENDON\uFFFDA"` (file, DBCS-corrupted) is flagged as
`Diferencia de Atributos` — a real difference — when it should be tolerated as the same encoding
artifact the comparator already tolerates for standard Spanish text.

## Root cause (diagnosed, orchestrator, do not re-investigate)

`src/core/common/GisEncodingNormalizer.ts`. `areAttributesEquivalent` correctly detects the
corrupted glyph (`CORRUPTED_GLYPH_REGEX` already matches `\uFFFD` — that part is fine) and calls
`matchesCorruptedAgainstClean`, which builds a regex wildcard to align the corrupted span against
the clean reference string via `resolveGlitchWildcard` (lines ~129-199).

The wildcard classes, and every letter/case test feeding them, are hardcoded to standard Spanish
accented letters only: `[A-ZÁÉÍÓÚÑÜ]` / `[a-záéíóúñü]` — see the `hasUpper`/`hasLower` checks
(lines 137-138), the returned wildcard classes (142, 145, 187, 195, 198), and the
prevLetter/nextLetter boundary-scan regexes (152, 156, 168, 172). RIVERA borders Brazil, so surnames
carry Portuguese letters — Ç, Ã, Õ, Â, À, Ê, Ô, Ì, Ù and lowercase forms. None of those are in the
class, so when one is corrupted to `\uFFFD` the generated regex cannot match it against the clean
DB value, `matchesCorruptedAgainstClean` returns `false`, and the attribute is wrongly flagged as
different. Confirmed by hand: `"EPAMINONDAS MENDON\uFFFDA"` vs `"EPAMINONDAS MENDONÇA"` fails today.

## Required fix

Do not hand-add more accented letters to the hardcoded classes — the file's own docstring claims
this module is algorithmic with "ZERO hardcoded pairs" / no lookup tables, and a Spanish-only
whitelist contradicts that for any border-region or foreign-origin name. **Generalize instead**:
replace every hardcoded Latin-accented character class used for letter/case/boundary detection in
this file with Unicode property escapes under the `u` regex flag — `\p{Lu}` (uppercase letter),
`\p{Ll}` (lowercase letter), `\p{L}` (any letter) as appropriate for each site:

- `hasUpper` / `hasLower` checks (lines 137-138) → test against `\p{Lu}` / `\p{Ll}` with `u` flag.
- The four wildcard classes `resolveGlitchWildcard` returns (142, 145, 187, 195) → `\p{Lu}{min,max}`
  or `\p{Ll}{min,max}` respectively; the mixed-case fallback (198) → `\p{L}{min,max}`.
- The prevLetter/nextLetter boundary scans (152, 156, 168, 172) and the `isPrevUpper`/`isPrevLower`/
  `isNextUpper`/`isNextLower` checks (177-180) → `\p{L}` for "is a letter", `\p{Lu}`/`\p{Ll}` for
  case.
- Every regex literal touched needs the `u` flag added (required for `\p{...}` to work in JS).

Do not touch `CORRUPTED_GLYPH_REGEX` / `CORRUPTED_GLYPH_GLOBAL_REGEX` (corruption detection is
already correct) or `WIN1252_LOOKUP` / `algorithmicUnmojibake` (unrelated code path). Preserve
exactly: strict case sensitivity, strict punctuation sensitivity, and the `{minLetters,maxLetters}`
length bounds (`matchLength` to `matchLength * 2`) on every wildcard.

## Tests required

In `tests/unit/utils/common/GisEncodingNormalizer.test.ts`, following the file's existing AAA style
(see e.g. line 101's "should resolve Hangul double-byte corruption..." test):

1. `areAttributesEquivalent` tolerates `"EPAMINONDAS MENDONÇA"` (DB) vs
   `"EPAMINONDAS MENDON\uFFFDA"` (file) with `ignoreEncodingArtifacts: true` — the reported bug,
   pinned as a regression test.
2. Same pair rejected when `ignoreEncodingArtifacts: false` — existing strict-mode contract
   preserved.
3. Case sensitivity still strict with a Ç-bearing string: uppercase corrupted span must not match a
   lowercase clean span (mirror the existing "should strictly enforce case sensitivity even when
   corrupted" test at line 129, using Ç/ç instead of Ñ/ñ).
4. A second Luso letter (Ã/ã) to prove the fix isn't Ç-specific, e.g. a DB value containing "ÃGUA"
   or similar against a `\uFFFD`-corrupted file value.
5. Confirm every existing test in the file still passes unchanged — do not weaken or delete any
   existing assertion.

Run the full existing test file, plus grep the repo for other consumers of `GisEncodingNormalizer`
(e.g. spatial/comparison workers) and re-run whatever unit suites touch them, to confirm broadening
the letter classes to `\p{L}` introduces no regression.

## Out of scope

- `CORRUPTED_GLYPH_REGEX`, `CORRUPTED_GLYPH_GLOBAL_REGEX`, `WIN1252_LOOKUP`, `algorithmicUnmojibake`,
  `repairEncoding` — untouched, this bug is not there.
- Any other file. This is a single-file, single-concern fix.
- Adding a hardcoded lookup table of "other languages' letters" — that is exactly the pattern being
  removed, not extended.

## Rules that bind this work

`.agents/rules/testing_standards.md`, `.agents/rules/code_review_standards.md`.

## Definition of done

Gauntlet green with real output pasted into `.agents/handoff/TO_ORCHESTRATOR.md`:
`modules:routes:check`, `lint`, `test`, `build`, `doctor`. The full existing 313-test unit suite
(now +5 or so with the new cases) must pass; no existing assertion altered. Report the new test
count and paste the relevant `test` gate output.

Do not commit.

---

# Fix round 1 — word-initial capital letters still mismatch

The gauntlet re-ran green independently (routes ✅, lint ✅, 317/317 unit tests ✅, build ✅,
doctor 100/100 ✅). A fresh-context `code-reviewer` confirmed the `u`-flag change is safe (no new
regex-throw risk on realistic street/address text, verified by fuzzing the escape function), single
BMP code units cover the whole Spanish/Portuguese accented alphabet (no surrogate-pair risk), and
the only production consumer chain (`GisStringSanitizer` → `SuidKeyResolver` /
`FeatureAttributeExtractor`) passes unchanged. **The Ç/Ã fix itself is correct and stays.**

## F1 [MAJOR] — word-initial corrupted letter infers the wrong case from the next letter alone

`GisEncodingNormalizer.ts`, `resolveGlitchWildcard`'s mixed-case branch (~lines 148-198). When a
corrupted glyph sits at the very start of a word (no `prevLetter` — the backward scan hits a space
or string start first), the code falls back to guessing the corrupted letter's case from the single
following letter: `(prevLetter === "" && isNextUpper)` → `\p{Lu}`, `(prevLetter === "" &&
isNextLower)` → `\p{Ll}`. That guess is only valid for ALL-CAPS or all-lowercase words. It is wrong
for Title Case — a capitalized first letter followed by lowercase letters, which is the normal
shape of a place name.

**Confirmed failing today** (reviewer verified by direct execution, reproducible on `main` too with
a plain-Spanish equivalent — this is a pre-existing defect in the exact branch this mission
rewrote, not a new regression):

```ts
GisEncodingNormalizer.areAttributesEquivalent(
  "Cachoeira do Sul Ãgua Branca",
  "Cachoeira do Sul �gua Branca",
  { ignoreEncodingArtifacts: true }
); // returns false — should be true
```

`Água` is exactly the shape of name this mission exists to tolerate (RIVERA/border-region place
names are typically Title Case), so leaving this branch broken defeats the point of generalizing
the heuristic in the first place.

**Required fix:** when `prevLetter === ""` (no letter precedes the corrupted span — start of word
or string), do **not** infer the corrupted letter's case from `nextLetter` alone. Drop the two
`prevLetter === "" && isNextUpper` / `prevLetter === "" && isNextLower` branches and let word-initial
corrupted letters fall through to the existing generic `\p{L}{min,max}` wildcard (the same fallback
already used for genuinely mixed-case strings). This only loosens case-strictness for the single
corrupted glyph at a word boundary where the case is genuinely ambiguous from local context — every
other character in the string, including the rest of the same word, remains a literal, case-strict
comparison. Do not touch the `isPrevUpper`/`isPrevLower` branches (those stay correct — a letter
*within* a word, with a real preceding letter to anchor on, keeps its existing inference).

**Add the regression test** the reviewer's finding implies: the exact `"Cachoeira do Sul Ãgua
Branca"` case above, asserting `true` with `ignoreEncodingArtifacts: true`. Also add one negative
control confirming case-strictness is not lost elsewhere: a mid-word corrupted letter with a real
`prevLetter` must still reject a wrong-case clean counterpart (this already has coverage via the
existing "should strictly enforce case sensitivity" tests — just confirm it still passes, no new
test required there unless you find a gap).

## Rejected — do not implement

- Any deeper redesign of the case-inference heuristic (e.g. multi-letter lookahead to distinguish
  Title Case from ALL-CAPS at word start). Falling through to `\p{L}` at word boundaries is the
  narrow, correct-enough fix; do not build a more elaborate disambiguation scheme.

## Definition of done

Gauntlet green again, real output pasted: `modules:routes:check`, `lint`, `test`, `build`,
`doctor`. 313 pre-existing + prior-round tests byte-identical; only additions. Report F1's
resolution and paste the `test` gate output showing the new count.

Do not commit.
