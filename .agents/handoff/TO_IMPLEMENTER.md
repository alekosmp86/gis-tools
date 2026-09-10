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
