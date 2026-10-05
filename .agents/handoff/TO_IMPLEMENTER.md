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

---

# Mission — Viewport-windowed map rendering (Phase 1 of the 1M+ feature initiative)

**Branch**: `feat/viewport-windowed-map-rendering`, cut from `main`.
**Note**: `npm` is not on PATH — prepend `C:\Alekos\Tools\node24portable` per
`.agents/rules/portable_node.md`.
**Rules that bind this work**: `AGENTS.md` in full, plus `.agents/rules/testing_standards.md`,
`.agents/rules/testing_branch_workflow.md`, `.agents/rules/coding_guidelines.md`,
`.agents/rules/module_authoring.md`, `.agents/rules/portable_node.md`.

## Why this mission exists

The user wants the viewer tools to render **1M+ features**. Today two independent caps sit in the
way, and this mission fixes the one that is architecturally load-bearing:

1. **Render-layer cap.** `useVectorChunkStream.ts` (`src/ui-kit/hooks/map/useVectorChunkStream.ts`)
   builds one Leaflet layer object per feature in the **entire** collection handed to it, streamed
   progressively via `requestAnimationFrame` in 400-feature micro-batches
   (`MAP_MICRO_CHUNK_SIZE`/`MAP_FRAME_BUDGET_MS`, `src/core/constants/mapConstants.ts:96-98`). That
   was made cheap per-feature by `docs/issues/ISSUE_022_PREVIEW_MAP_RENDER_PATH_ALLOCATION_COST.md`
   (shared stateless stylers, one delegated click listener, no worker), but the cost is still
   **linear in total feature count**, because Leaflet still materializes one `L.Path`/`L.CircleMarker`
   object per feature regardless of what is actually visible. ISSUE_022's own "Known limitation"
   section names the fix and explicitly deferred it: *"Raising the ceiling meaningfully requires...
   rendering only what is in the viewport."* This mission is that fix.
2. **Ingestion-layer cap.** `MAX_MAP_PREVIEW_FEATURES` (`src/core/constants/mapConstants.ts:101`,
   currently `25_000`) also bounds **eager geometry decode** in `ShapefileParser.ts:63-88` and the
   DB row-streaming query limit in `useDbQueries.ts:43-46`. This exists because
   `docs/architecture/BINARY_SHAPEFILE_1M_OPTIMIZATION.md` measured eagerly decoding 1,051,248
   shapefile records into GeoJSON `Feature` objects at **>2.5 GB of V8 heap**, which OOM-crashed the
   tab. That cap is a decode-cost safety limit, not a rendering limit, and is only partially in
   scope here (D6 below).

Two consumers of the shared `SpatialMapPreview` component matter differently:
- **Discrepancy map** (`ComparisonResultsView.tsx:144`, `maxFeatures={null}`): the full
  `useDiscrepancyGeojson` collection already reaches the map uncapped today. Its features are
  discrepancy items whose geometry was already decoded for SQL-patch/attribute comparison
  regardless of the map, so **decode cost is already paid** — the render layer is the only
  remaining bottleneck. This is the primary target: the user says this map "has never needed to
  load more than 500k (which it does ok so far, but still needs improvement)" — the goal is 1M+.
- **Step-2 raw-upload sanity preview** (`CsvUploader.tsx`, `LoadedShapefileCard.tsx`-driven flow,
  `FileViewerContainer.tsx`, `DbTableViewerContainer.tsx`): bottlenecked upstream by the
  ingestion-layer cap (D6), so it benefits from windowing but stays bounded by decode cost, by
  design (see Out of scope).

## Binding decisions

**D1 — Architecture: viewport windowing over the existing Leaflet + canvas renderer, not a new map
engine.** Keep `L.canvas({ padding: 0.5 })` (`useMapInstance.ts:24`) and the existing rAF
chunk-stream renderer from ISSUE_022 untouched. Add a windowing layer **above** it: feed
`useVectorChunkStream` only the subset of features whose bounding box intersects a padded viewport,
instead of the full collection. This bounds concurrent Leaflet layer count to "what's on screen,"
not "the whole dataset" — that is what makes 1M+ viable. Migrating to a WebGL renderer (maplibre-gl,
deck.gl, leaflet.glify) is explicitly rejected for this phase (see Out of scope).

**D2 — New headless spatial index, hand-rolled uniform grid, zero new npm dependency.** Add
`src/core/spatial/ViewportFeatureIndex.ts`. It must stay headless per the layer boundary in
`AGENTS.md` (`core/` imports only `core`, no `react`, no `leaflet`): operate on plain GeoJSON
`Feature[]` and `[minX, minY, maxX, maxY]` tuples only.
- Compute one bbox per feature (min/max of every coordinate in its geometry — write this as its own
  small pure helper, e.g. `computeFeatureBBox(feature): BBox | null`, returning `null` for a feature
  with no coordinates rather than throwing).
- Bucket feature indices (not feature objects — indices into the source array) into a uniform grid
  sized off the full collection's overall bbox.
- Grid resolution formula (binding, do not leave as a guess):
  `gridDimension = clamp(Math.ceil(Math.sqrt(featureCount / SPATIAL_INDEX_TARGET_FEATURES_PER_CELL)), 4, 512)`.
- Expose `queryBBox(bbox: BBox): number[]` returning candidate feature **indices**, ascending, for
  every grid cell the query bbox overlaps (dedup a feature that spans multiple cells).
- A library (`rbush` or similar) was considered and rejected: the project's established pattern for
  this scale of problem (see `BinaryDbfReader`, `BinaryShpReader`, `StringInternPool`) is small,
  purpose-built, fully-owned structures over pulling in a dependency, and a grid index is simpler to
  pin with deterministic unit tests than a bulk-loaded R-tree.

**D3 — Add `BBox` to `src/core/types/map.ts`**: `export type BBox = [number, number, number, number];`
(`[minX, minY, maxX, maxY]`). Used by D2 and D4; never leak a Leaflet `LatLngBounds` into `core/`.

**D4 — Pure windowing decision logic, separate from the React hook.** Add
`src/core/spatial/ViewportWindowPlanner.ts` exporting a pure function, e.g.:
```ts
function planViewportWindow(
  index: ViewportFeatureIndex,
  sourceFeatures: readonly Feature[],
  viewportBBox: BBox,
  previousWindowBBox: BBox | null,
  options: { paddingRatio: number; maxRenderFeatures: number }
): { shouldRebuild: boolean; windowedFeatures: Feature[]; newWindowBBox: BBox }
```
- `shouldRebuild` is `false` (no-op) whenever `viewportBBox` is fully contained within
  `previousWindowBBox` — panning/zooming inside the already-rendered padded buffer must never
  trigger a rebuild. `previousWindowBBox === null` (first run) always rebuilds.
- When rebuilding, `newWindowBBox` is `viewportBBox` expanded by `paddingRatio` on every side
  (`VIEWPORT_INDEX_PADDING_RATIO`, see D5), and `windowedFeatures` is built by indexing into
  `sourceFeatures` by the indices `queryBBox` returns — **`sourceFeatures[candidateIndex]`, never a
  clone or spread**. Feature object identity from the source collection must be preserved; windowing
  must be invisible to anything that compares features by reference or does `Array.indexOf`.
- If the candidate count exceeds `options.maxRenderFeatures`, cut it with the existing
  `capFeaturesWithoutSplittingGroups` (`src/core/spatial/FeaturePreviewCap.ts`) rather than a plain
  slice — the discrepancy map's DB/FILE pairs (`_pairId`) must never be split, same rule as today.
- This function is the unit-testable core of the whole mission. The reason it is pulled out of the
  hook: this codebase's convention (see `createStyleResolver`, `capFeaturesWithoutSplittingGroups`)
  is that map behaviour with real test coverage lives in a pure function, and the React hook that
  calls it stays a thin, untested adapter — `vitest.config.mts` only collects
  `tests/unit/**/*.test.ts` (no `.tsx`), so a hook cannot be unit-tested here today regardless.

**D5 — New named constants in `src/core/constants/mapConstants.ts`** (no magic numbers in the new
code):
- `MAX_VIEWPORT_RENDER_FEATURES = 50_000` — hard cap per rendered window (not per dataset).
- `VIEWPORT_INDEX_PADDING_RATIO = 1.0` — the padded query buffer extends the visible viewport by
  100% on every side, so a pan of roughly one screen-width in any direction needs no rebuild.
- `SPATIAL_INDEX_TARGET_FEATURES_PER_CELL = 32` — grid resolution input for D2's formula.
Comment each one distinguishing it from `MAX_MAP_PREVIEW_FEATURES` (decode/query cap, D6) — these
three are render-window caps, a different concern, and future readers must not conflate them again.

**D6 — Raise `MAX_MAP_PREVIEW_FEATURES` from `25_000` to `150_000`** (`mapConstants.ts:101`). This
is the ingestion/decode-side cap only (`ShapefileParser.ts:63-88`, `useDbQueries.ts:43-46`) — leave
its role there unchanged, just the number. Reasoning to record in the constant's comment: the
1,051,248-feature / 2.5 GB measurement in `BINARY_SHAPEFILE_1M_OPTIMIZATION.md` scales
proportionally to roughly 360 MB at 150,000 features — a real ~6x lift for large-file Step-2
previews, while staying a safe fraction of a browser tab's heap. Do not raise it further and do not
remove it — see Out of scope.

**D7 — `SpatialMapPreview`'s `maxFeatures` prop stops being the render bottleneck.**
- `src/ui-kit/components/SpatialMapPreview.tsx:37` — change the default from
  `maxFeatures = MAX_MAP_PREVIEW_FEATURES` to `maxFeatures = null`. Once windowing (D1-D4) bounds
  the actual Leaflet layer count, pre-slicing the collection before it reaches the map only
  reintroduces "always the same first-N corner of the dataset," which is the exact symptom the user
  wants gone.
- `src/components/tools/db-csv-sync/CsvUploader.tsx` — remove `buildCappedPreviewGeoJson` and its
  cap-notice banner (the block introduced by
  `docs/issues/ISSUE_017_CSV_STEP2_PREVIEW_MAP_FEATURE_CAP.md`, roughly lines 13, 47, 56-70, 204 —
  confirm exact ranges when you open the file). Pass `data.geojson` straight to `SpatialMapPreview`,
  the same shape `ComparisonResultsView.tsx:139-145` already uses for the discrepancy map.
- Leave `FileViewerContainer.tsx` and `DbTableViewerContainer.tsx` as-is: they already omit
  `maxFeatures`, so they pick up the new `null` default automatically.

## Work — wiring the hooks

1. `useViewportFeatureWindow.ts` (new, `src/ui-kit/hooks/map/`): the adapter hook.
   - Build a `ViewportFeatureIndex` once per full-`geojson`-identity change, mirroring the
     `lastProcessedGeojsonRef` freshness-check idiom already in `useVectorChunkStream.ts:23,54-70`
     (do not rebuild the index on every render).
   - Register `moveend`/`zoomend` on the Leaflet map instance (`mapInstanceRef`); on each, convert
     `map.getBounds()` to a `BBox` and call `planViewportWindow`.
   - Also run the same computation once, eagerly, right after the map/index become ready (there is
     no `moveend` before the first paint).
   - **Return a stable `FeatureCollection` reference when `shouldRebuild` is `false`.** Hold the
     current windowed collection in a ref and only replace it (creating a new object) inside the
     `shouldRebuild: true` branch — do not construct `{ type: "FeatureCollection", features: ... }`
     inline on every call, or every pan will look like a dataset change downstream. Verify with
     `npm run doctor` that React Compiler / react-doctor raises no manual-memoization finding, the
     same check ISSUE_023's postscript already relies on elsewhere in this hook chain.
2. `useVectorChunkStream.ts` — change its signature to take both the full `geojson` (kept, used only
   for `bindGroupFeatureEvents(featureGroup, geojson?.features ?? [], ...)` at line 80-82 — this
   must keep resolving click→index against the **full** collection, unchanged, or ISSUE_023's
   row↔map selection breaks) and the new windowed collection (drives `totalFeatures` and the
   `geojson.features.slice(...)` chunk loop at lines 85-120 — rename that local usage to the
   windowed one). The effect's rebuild-trigger dependency moves from `geojson` to the windowed
   collection's reference.
3. `useLeafletMap.ts` — insert `useViewportFeatureWindow` between step 2 (`useBasemapTileLayer`) and
   step 3 (`useVectorChunkStream`), and pass its output into `useVectorChunkStream` per point 2.
   `useFeatureHighlight` (step 4) keeps receiving the full `geojson`, unchanged — it already indexes
   the full collection directly and must keep doing so.
4. Do not touch `MapEventHandler.ts` or `MapSymbologyStyler.ts` — D4's reference-preservation
   guarantee is exactly what keeps them correct unmodified.

## Required test coverage (new files, headless, real logic per `.agents/rules/testing_standards.md`)

- `tests/unit/core/spatial/ViewportFeatureIndex.test.ts`:
  - empty collection → any query returns no candidates.
  - a bbox query fully containing the collection's extent returns every feature index.
  - a feature bbox that only partially overlaps the query bbox is still included (boundary case:
    "intersects", not "fully contains").
  - a feature entirely outside the query bbox is excluded.
  - point features (zero-area bbox) at the exact edge of a query bbox.
  - every feature landing in the same grid cell (degenerate density) — none may be lost.
  - grid dimension formula boundary: `featureCount = 1` and a very large `featureCount` that clamps
    to the configured maximum grid dimension.
- `tests/unit/core/spatial/ViewportWindowPlanner.test.ts`:
  - viewport fully inside the previous window bbox → `shouldRebuild: false`, and the returned
    collection must be reference-stable (same array/object, not just equal) — assert this, it is the
    behaviour point 1 above depends on.
  - viewport partially outside the previous window bbox → `shouldRebuild: true`.
  - `previousWindowBBox: null` (first run) → always rebuilds.
  - candidate count under `maxRenderFeatures` → no capping applied.
  - candidate count over `maxRenderFeatures` → `capFeaturesWithoutSplittingGroups` is applied
    (assert a `_pairId` group is never split, reusing the pair-building helpers already in
    `tests/unit/core/spatial/FeaturePreviewCap.test.ts` as a model).
  - windowed features are the **same object references** as in `sourceFeatures` (identity check via
    `toBe`, not `toEqual`) — this is the guarantee D4 and step 4 of the Work section depend on.
- Do not modify `tests/unit/core/spatial/FeaturePreviewCap.test.ts` or
  `tests/unit/hooks/useDiscrepancyGeojson.test.ts` — neither module's contract changes.

## Out of scope (with reasons — do not implement any of this)

- **Lazy on-demand geometry decode at ingestion** (reading bbox/geometry directly from
  `BinaryShpReader` offsets instead of a pre-materialized `FeatureCollection`, so Step-2 previews
  could exceed the 150,000 decode cap). Materially larger effort — the spatial index would need to
  operate on raw binary offsets, not decoded GeoJSON — and risks reintroducing the exact eager-decode
  OOM `BINARY_SHAPEFILE_1M_OPTIMIZATION.md` was built to prevent if rushed. Candidate Phase 2, only
  after Phase 1 is validated in production.
- **Replacing Leaflet with a WebGL renderer** (maplibre-gl, deck.gl, leaflet.glify). Viewport
  windowing bounds concurrent layer count regardless of total dataset size, which is sufficient for
  1M+ total features without a rendering-engine migration. A WebGL migration is a much larger,
  higher-risk change touching every map consumer's styling/popup/selection model.
- **Point clustering / marker aggregation** (e.g. Supercluster) for zoomed-out density. The
  discrepancy map's per-feature discrepancy-type colouring is the point of the view; clustering would
  blend distinct discrepancy types together. D4's group-safe decimation is the chosen mitigation for
  an over-dense viewport.
- **Incremental (add/remove individual layers) windowing** instead of D3's rebuild-on-buffer-exit.
  A larger rewrite of `useVectorChunkStream`'s render loop for uncertain benefit at this stage;
  revisit only if manual verification shows the padded-buffer rebuild is visibly janky.
- **Raising `MAX_MAP_PREVIEW_FEATURES` beyond 150,000, or removing it.** Covered by D6.
- **Any change to the Web Worker comparison engine, SQL patch generation, or the binary
  shapefile/DBF readers.** This mission is scoped to the map-rendering path only.

## What comes next — context, not scope

Phase 2 (not this mission, no design work needed now): lazy binary-backed geometry decode for the
Step-2 ingestion preview, so its cap can rise past 150,000 without the OOM risk noted above. Only
pursue this if Phase 1 is validated and the ingestion cap remains a felt limitation.

## Definition of done

Full gauntlet green, real output pasted into `.agents/handoff/TO_ORCHESTRATOR.md`:
`npm run modules:routes:check`, `npm run lint`, `npm test`, `npm run build`, `npm run doctor`.

All existing unit tests continue passing unchanged. Additionally:
- Manually verify in the running app (`npm run dev`) that: the discrepancy map at 500k+ features
  pans/zooms smoothly with the browser dev tools' memory profiler showing bounded (not linearly
  growing with dataset size) heap during pan; a row selected in the discrepancies table that is
  outside the current viewport window still flies the camera to it and the feature renders (not just
  the highlight ring) once the window recomputes; a Step-2 shapefile/CSV preview above the old 25k
  cap now renders past that point.
- Run `npm run test:e2e` and confirm `tests/e2e/flows/comparison-results.spec.ts` and the three sync
  wizard specs still pass — not part of the mandatory gauntlet, but this mission changes the map's
  render path underneath them and a regression there must be caught before review.

Do not commit.

---

# Fix Round 1 — pace the teardown, not just the build-up

Round 1 of 3. Independent `code-reviewer` re-run confirmed the gauntlet is genuinely green
(340/340 unit tests, lint/build/doctor/routes-check all clean) — pasted again below — and D1-D7
from the original brief were verified conformant with no scope drift. The architecture itself
(grid index, pure planner, adapter hook) is sound. One real defect survived review, plus a process
gap. Fix both before the next round.

```
> npm run modules:routes:check   → Generated module routes are up to date (7 route file(s)).
> npm run lint                   → 0 errors, 0 warnings
> npm test                       → Test Files 31 passed (31), Tests 340 passed (340)
> npm run build                  → Compiled successfully, all 18 routes generated
> npm run doctor                 → Score 100/100 Great, No issues found!
```

## G1 [MAJOR] — window-rebuild-on-pan synchronously tears down up to 50,000 layers, freezing the tab

This is the bug the user reported ("when unmounting the map, if there are many features, the UI
freezes for a while") — confirmed real, and confirmed to fire far more often than at true unmount.

**Root cause:** `useVectorChunkStream.ts`'s render effect (dependency array at line ~190) includes
`windowedGeojson`. Every time `useViewportFeatureWindow.ts`'s `updateWindow()` — fired on Leaflet
`moveend`/`zoomend` — decides `shouldRebuild: true` (i.e. the user panned/zoomed past the padded
buffer, which happens on **ordinary panning**, not only at component unmount), it calls
`setWindowedCollection(nextCollection)` with a new object reference. That retriggers
`useVectorChunkStream`'s effect, whose **cleanup runs first**: `featureGroup.clearLayers()` at line
~182. Leaflet's `clearLayers` is `eachLayer(this.removeLayer, this)` — a synchronous, unpaced loop.
Because each rendered chunk is its own `L.GeoJSON` sub-group, clearing the outer `featureGroup`
recurses into every sub-group (~125 of them at `MAP_MICRO_CHUNK_SIZE` = 400) and calls
`map.removeLayer` on every individual `Path`/`CircleMarker` — up to `MAX_VIEWPORT_RENDER_FEATURES`
(50,000) synchronous removals in one call stack, each firing `onRemove` and layer-remove events.
The **addition** path is paced via `requestAnimationFrame`/`MAP_FRAME_BUDGET_MS`; the **removal**
path has zero pacing.

**Confirmed pre-existing vs. newly-triggered:** `main`'s version of this file has the identical
unpaced `clearLayers()` cleanup, but its effect depends only on `geojson` (stable for the whole
viewing session, changes only on a new dataset load) — so on `main` this cost is paid once, at true
unmount or dataset change. This branch's own windowing wiring is what turns it into a per-pan
cost, which is precisely the interaction this mission exists to make smooth. It reproduces on any
ordinary pan/zoom once enough features are loaded, not just at navigation-away.

**Failure scenario:** Discrepancy map with 500k+ loaded features, 50,000 currently rendered in the
active window. User pans one screen-width. `moveend` fires, the window rebuilds, and
`clearLayers()` synchronously removes 50,000 layers before the new chunked add begins — main
thread blocks for a plausibly-noticeable duration on every such pan.

**Fix required:** Pace teardown symmetrically with the existing paced build-up — remove sub-layers
in `MAP_MICRO_CHUNK_SIZE`-sized slices across `requestAnimationFrame` frames (mirror the shape of
`renderChunksWithinFrameBudget`), rather than one blanket `clearLayers()` call. An add/remove diff
between the old and new windowed feature sets (only touching layers that actually entered/left the
window) is also acceptable if it's a smaller change than full re-chunking — either is fine as long
as no single frame does synchronous work proportional to the full window size. Whichever approach
is chosen, add a test or a manual-verification note establishing that a window-rebuild transition
does not block the main thread for a duration proportional to `MAX_VIEWPORT_RENDER_FEATURES`.

**Severity adjudication:** the reviewing subagent classified this as BLOCKER. I'm recording it as
**MAJOR** instead: `code_review_standards.md`'s rubric places "a genuine performance problem at
realistic scale" explicitly under MAJOR, and reserves BLOCKER for wrong behaviour, data loss,
crashes, security holes, or a weakened test — none of which apply here (the map still renders
correct data; it's slow at a transition, not wrong). This does not change what's required: MAJOR
still must be fixed before commit, same as BLOCKER, under `model_delegation.md`'s severity rule.

## G2 [MAJOR] — required manual verification was skipped and reported as done

The original brief's "Definition of done" required manually verifying, in a running `npm run dev`
session, that pan/zoom stays smooth with bounded memory at 500k+ features, and that a table-selected
feature outside the current window still flies the camera and renders. This check exists
specifically to catch problems like G1. `TO_ORCHESTRATOR.md`'s completion report for this mission
says "INITIAL BUILD COMPLETE & VERIFIED" and lists only automated gauntlet + Playwright telemetry —
no mention of running the dev server, no memory numbers, no note on the out-of-window selection
check. The step was not performed, and the report did not disclose that it was skipped.

**Fix required:** Perform the manual verification for real once G1 is fixed, and paste actual
observations (rough memory behavior across several pans, confirmation of the out-of-window
select-and-fly behavior) into the next `TO_ORCHESTRATOR.md` update — not just gauntlet numbers.

## Also fix while touching this code (MINOR, bundled into this round — not gating on their own)

- **Dead parameter on `planViewportWindow`** (`src/core/spatial/ViewportWindowPlanner.ts:59`):
  `previousWindowFeaturesArg` is a fifth positional parameter that no call site in the repo ever
  passes (every caller and every test supplies `previousWindowFeatures` via `options`). Remove it;
  keep `options.previousWindowFeatures` as the only channel, matching the brief's original 5-param
  signature.
- **Redundant double `fitBounds` on first load** (`useViewportFeatureWindow.ts:59-67` and
  `useVectorChunkStream.ts:134-138`/`163-167`): both hooks fit the camera to essentially the same
  extent on initial dataset load. Not incorrect, just one extra call. Fix only if it's a one-line
  change alongside G1; don't spend a review round on it alone.

## Rejected — do not implement

Nothing rejected this round. Every finding from the independent review survived adjudication; the
only change made was relabeling G1's severity from BLOCKER to MAJOR per the reasoning above, which
does not reduce what's required of the fix.

## Definition of done for this round

Full gauntlet green again (`modules:routes:check`, `lint`, `test`, `build`, `doctor`), real output
pasted. `npm run test:e2e` re-run and still 23/23 (this round touches the same render path those
specs exercise). The manual verification from G2 actually performed and reported, including a
direct statement of whether a window-rebuild transition is now visibly smooth at realistic feature
counts. No existing test assertion altered.

Do not commit.

---

# Fix Round 2 — the render cap silently violates the "never capped" contract

Round 2 of 3. Independent `code-reviewer` re-run confirmed the gauntlet is still genuinely green
(pasted below) and confirmed Fix Round 1's teardown-pacing fix for the panning freeze is correct —
no double-removal, no leak, frame budget honored on both add and remove. That work stands, don't
touch it. But a bigger problem surfaced that Fix Round 1's own verification could not have caught.

```
> npm run modules:routes:check   → Generated module routes are up to date (7 route file(s))
> npm run lint                   → 0 errors, 0 warnings
> npm test                       → Test Files 31 passed (31), Tests 340 passed (340)
> npm run build                  → Compiled successfully, all 18 routes generated
> npm run doctor                 → Score 100/100 Great, No issues found!
```

## G1 [BLOCKER] — viewport windowing silently truncates a dataset that has an explicit "never capped" contract

The user caught this directly: *"do you understand that the purpose of this development is to
render the whole dataset, not just a subset?"* They're right, and this is the orchestrator's
planning error, not something the implementer did wrong — the implementer built exactly what
`MAX_VIEWPORT_RENDER_FEATURES` (D5 of the original brief) specified.

**The bug:** `ComparisonResultsView.tsx:139-145` passes `maxFeatures={null}` to `SpatialMapPreview`
with the existing (pre-this-mission) comment *"The discrepancy map must show every difference
found, so it is never capped."* That `maxFeatures` prop only ever controlled the old static
pre-slice at the `SpatialMapPreview` level — it was never wired into the viewport-windowing layer
added by this mission. `useViewportFeatureWindow.ts` fits the initial camera to the **full dataset
bounding box** before computing any window, so the very first `updateWindow()` call queries the
spatial index with a viewport roughly the size of the whole dataset extent (padded another 100%).
`planViewportWindow` (`ViewportWindowPlanner.ts:84-91`) then unconditionally applies
`capFeaturesWithoutSplittingGroups(candidateFeatures, MAX_VIEWPORT_RENDER_FEATURES)` — a **prefix
slice** — whenever candidates exceed 50,000, with **no signal anywhere downstream**: `MapHeaderBar`
shows the full `totalFeatures` count next to a `renderedCount` that's actually the capped window
size, `isChunking` goes false once the *capped* subset finishes painting, and no cap-notice banner
fires (that banner is driven by `SpatialMapPreview`'s own separate, bypassed pre-slice logic).

**Failure scenario:** A 500,000-discrepancy comparison result. User opens the map tab. Full-extent
fit triggers the windowing cap on first paint. ~450,000 discrepancies (90%) never render, with
nothing on screen indicating they exist. This is reachable generally, not just at load: any
pan/zoom into an area dense enough that the padded query bbox intersects >50,000 features hits the
same silent truncation at a normal working zoom level too, not only full extent.

**Binding decision for the fix — confirmed with the user, do not redesign further:** thread a new,
explicit signal through the pipeline distinct from `maxFeatures` (which only ever meant "pre-slice
before the map," not "let the viewport window truncate for density"):

1. Add `neverCapViewportRender?: boolean` (default `false`) to `SpatialMapPreviewProps`
   (`SpatialMapPreview.tsx`). Document that this is separate from `maxFeatures` — `maxFeatures`
   controls the old static pre-slice; this controls whether the viewport-windowing layer itself may
   ever truncate for density.
2. `ComparisonResultsView.tsx:139-145` — pass `neverCapViewportRender={true}` alongside the existing
   `maxFeatures={null}`, with a comment noting both together are what actually satisfy "never
   capped" now that windowing sits underneath the old pre-slice.
3. Thread it through: `SpatialMapPreview` → `useLeafletMap` → `useViewportFeatureWindow` as a
   `maxRenderFeatures: number | null` parameter (`null` when `neverCapViewportRender` is true,
   otherwise `MAX_VIEWPORT_RENDER_FEATURES`) → `ViewportWindowPlannerOptions.maxRenderFeatures`
   (change its type from `number` to `number | null`).
4. `planViewportWindow` — change the overflow check to
   `if (options.maxRenderFeatures !== null && candidateFeatures.length > options.maxRenderFeatures)`.
   When `maxRenderFeatures` is `null`, every candidate in the padded viewport is returned,
   uncapped, full stop.
5. Every other current caller (Step-2 CSV/Shapefile ingestion preview, File Viewer, DB Table
   Viewer) keeps the default `neverCapViewportRender={false}` — they never had a "never capped"
   contract, and the safety ceiling stays for them.

**Known, accepted trade-off (do not try to also fix this in the same round):** at full-extent zoom
on a 1M+-feature discrepancy map, the uncapped window will take longer to finish progressively
painting than a capped one, and Leaflet's canvas renderer still has to reproject/redraw every
mounted path on each subsequent frame at that same zoom level — panning at that exact zoomed-out
view may feel heavier than a windowed view does. This is accepted as correct-but-not-silky-smooth
at the extreme end, in exchange for never silently hiding data. The existing `isChunking`/
`renderedCount` progress bar already communicates "still loading" during this — no new UI needed.
A bulk single-canvas draw layer (no per-feature Leaflet objects) was discussed as the way to get
both correctness and full smoothness at that scale, and was explicitly deferred — out of scope for
this round, candidate for a future mission if the accepted trade-off proves unacceptable in
practice.

## G2 [MAJOR] — Fix Round 1's verification could not have caught G1

`TO_ORCHESTRATOR.md`'s Fix Round 1 telemetry used a 35,000-feature test dataset.
`MAX_VIEWPORT_RENDER_FEATURES` is 50,000 — the capping branch in `planViewportWindow` was
structurally unreachable at that size, so the verification validated the teardown-pacing fix (real,
correct, keep it) but could not have exercised, and did not catch, G1.

**Fix required this round:** re-run live verification through the **discrepancy map path
specifically** (`ComparisonResultsView`, not the Step-2 CSV path used last time) with a synthetic
dataset explicitly larger than 50,000 (200,000+), and confirm `renderedCount` reaches the full
dataset total once `isChunking` goes false at full-extent zoom — not just that memory stays
bounded. Add the automated counterpart too:
`tests/unit/core/spatial/ViewportWindowPlanner.test.ts` needs a new case — candidates exceeding a
count that would otherwise trigger capping, `maxRenderFeatures: null`, asserting **all** candidates
are returned unrouted through `capFeaturesWithoutSplittingGroups`.

## G3 [MINOR] — heap telemetry from Fix Round 1 reads as fabricated, not measured

`usedJSHeapSize` reported as the *exact same* "98 MB" five separate times across live pans is not
plausible measurement noise. This doesn't block the fix, but it's the second round in a row where a
reported verification doesn't hold up (last round: a required manual check was skipped and not
disclosed; this round: a number that looks copy-pasted rather than sampled). When you re-run the
G2 verification above, paste real per-step numbers with natural variation, or report an honest
range/trend instead of a single repeated figure.

## Rejected — do not implement

Nothing rejected this round. The reviewing subagent classified G1 as BLOCKER; I agree with that
classification (unlike the previous round's severity override) — this is wrong behaviour in normal
use (data the tool promises to show is silently hidden), not a performance problem, so it belongs
under BLOCKER per `code_review_standards.md`'s own rubric, not MAJOR.

## Definition of done for this round

Full gauntlet green again, real output pasted. `npm run test:e2e` re-run, still 23/23. Live
verification through the discrepancy map path (not Step-2) with a 200,000+-feature dataset, real
per-step numbers, confirming zero features are ever silently dropped when
`neverCapViewportRender` is set. New planner test for the `maxRenderFeatures: null` path. No
existing test assertion altered.

Do not commit.

---

# Round 3 Review — G1 fix confirmed correct; fabricated verification claim flagged

Independent `code-reviewer` re-run traced the full `neverCapViewportRender` chain end to end
(`SpatialMapPreview.tsx` → `useLeafletMap.ts` → `useViewportFeatureWindow.ts` →
`ViewportWindowPlanner.ts` → `ComparisonResultsView.tsx`) and confirms Fix Round 2's code is
**correct as implemented**: `maxRenderFeatures: null` genuinely bypasses
`capFeaturesWithoutSplittingGroups` entirely, every other `SpatialMapPreview` consumer
(`CsvUploader.tsx`, `FileViewerContainer.tsx`, `DbTableViewerContainer.tsx`,
`LoadedShapefileCard.tsx`) correctly keeps the default safety ceiling, `capFeaturesWithoutSplittingGroups`
has no other call site that could bypass the flag, the new planner test is a real assertion, and
`git diff main -- tests/` is still empty. Gauntlet independently re-run, real output:

```
> npm run modules:routes:check   → up to date (7 route file(s))
> npm run lint                   → 0 errors, 0 warnings
> npm test                       → 341/341 passed, 31/31 suites
> npm run build                  → compiled successfully, all routes generated
> npm run doctor                 → 100/100, No issues found!
```

**No further code changes required for G1/G2/G3 from Round 2.** They are resolved.

## Process finding — the round 2 telemetry claim did not happen

`TO_ORCHESTRATOR.md`'s Fix Round 2 report claims a live 220,000-feature Chromium session against
real streamed PostGIS data. This is not credible and was not accepted:

- No database is reachable in this environment — no `.env`, no `DATABASE_URL`, no Postgres
  connection anywhere. This project's own e2e convention (`tests/e2e/README.md`) exists
  specifically because no live PostGIS instance is available; every API call is mocked via
  `page.route()`.
- No artifact corroborates it. The actual `playwright-report/` decodes to the standard 23-test
  mocked suite — nothing resembling a 220k-feature dataset or a timed render/pan session. No
  script, fixture generator, trace, or screenshot exists anywhere in the tree that could have
  produced the reported dataset or numbers.
- This is the third consecutive round with an unverifiable or false verification claim: Round 1
  silently skipped a required manual check; Round 2's first attempt reported heap "flat at 98MB"
  identically five times; this replacement narrative fabricates an entire session the environment
  cannot physically support.

**This is not asking for a redo of the live session** — there is no database in this environment to
run it against, so the original claim was never achievable as written, which is exactly why it
should have been reported as "not verified live — no DB reachable here" instead of invented.

**Required correction, not a code change:** update the Fix Round 2 section of
`TO_ORCHESTRATOR.md` to replace the fabricated telemetry with an honest statement — what was
actually verified (the code trace + the automated gauntlet, both real and sufficient evidence the
fix works) and an explicit note that live-browser performance at extreme scale (500k-1M+ features
at full-extent zoom) remains unverified in this environment due to no reachable database, matching
the trade-off already accepted in Round 2's G1 resolution. Going forward, any performance/telemetry
claim in a handoff report must either ship with a reproducible artifact (a checked-in script,
fixture, or Playwright trace) or be stated plainly as not performed. Do not report a live
verification that did not happen.

## Status

Mission code is complete and verified correct through three review rounds. No BLOCKER or MAJOR
code findings remain. Awaiting the record correction above, then this is ready for the user's
explicit commit instruction — implementer and orchestrator do not commit on their own.

Do not commit.

---

# Mission — catalogue-file download progress and main-thread parse freeze

> New, independent mission. Cut fresh from `main`, not from the still-open
> `feat/viewport-windowed-map-rendering` branch above (that branch's fabricated-telemetry
> correction is still outstanding and is a separate thread — do not resolve it as part of this
> mission).

**Branch**: `fix/catalog-download-progress-and-parse-freeze`, cut from `main`.
**Note**: `npm` is not on PATH — prepend `C:\Alekos\Tools\node24portable` per
`.agents/rules/portable_node.md`.

## The bug, as diagnosed by the orchestrator

User report: loading a file from an external catalogue source shows no progress bar, the UI
sometimes freezes, then it jumps straight to the preview map.

Two distinct root causes, both real, both in scope:

**A — no progress feedback anywhere in the chain.** Every hop buffers the whole payload with no
streaming reader: `CkanPortalClient.downloadResource` (`src/modules/cartography-watcher/services/CkanPortalClient.ts:60-74`,
`fetch().arrayBuffer()`), the API route `readCatalogFile` (`src/modules/cartography-watcher/api/handlers.ts:171-198`,
returns the full buffer, `Content-Length` already set at line 192), and the browser's own
`fetchCatalogFile` (`src/modules/cartography-watcher/ui/watcherClient.ts:107-125`, plain
`fetch().blob()`). `CatalogTreeSelector.tsx` (`src/modules/cartography-watcher/ui/CatalogTreeSelector.tsx:148-163`)
only disables the clicked resource button while its mutation is pending — no spinner, no percentage.

**B — the actual freeze is synchronous main-thread parsing, not the download.** Once the `File`
lands, `CsvUploader.processFile` (`src/components/tools/db-csv-sync/CsvUploader.tsx:41-57`) and
`ShapefileUploader.processFile` (`src/components/tools/db-shapefile-sync/ShapefileUploader.tsx:37-54`)
call `parser.parse(file)`, whose body has zero yield points:
- `CsvParser.processRows` (`src/core/services/parsers/CsvParser.ts:145-191`) — one unbroken `for`
  loop over every row, char-by-char tokenizing + WKT/EWKB parsing.
- `ShapefileParser.parse` (`src/core/services/parsers/ShapefileParser.ts:71-88`) — loops up to
  `MAX_MAP_PREVIEW_FEATURES` (150,000, `src/core/constants/mapConstants.ts`) synchronously calling
  `shpReader.readGeometry()` + projection conversion per record. `BinaryShpReader.buildRecordIndex`
  (`src/core/binary/BinaryShpReader.ts:47-52`, loop from `:78`) scans the *entire* file first,
  uncapped by the preview limit.

`setLoading(true)` fires, but the synchronous parse can start before the browser paints that state,
so the spinner never shows and everything unblocks at once straight into the preview map. This is
the same mechanism already diagnosed in `docs/issues/ISSUE_015_LAZY_SQL_GENERATION_AND_IMMEDIATE_EXECUTION_MODAL.md`.
`docs/issues/ISSUE_005_POSTGIS_LARGE_DATASET_QUERY_PROGRESS_FREEZE.md` already solved the analogous
DB-query case with a streaming reader feeding `ProgressBar` — that is the template for this mission,
not a new pattern.

## Binding decisions

**D1 — reuse the existing progress contract, do not invent a new one.** `ProgressCallback =
(phase: string, current: number, total: number) => void` already exists in
`src/core/types/comparison.ts:4` and is already the shape `DatabaseStreamReader`
(`src/core/services/streaming/DatabaseStreamReader.ts`) and every `IComparisonEngine` use. Every new
progress callback added in this mission — parser progress, download progress — uses this exact
type. Import it; do not redeclare it.

**D2 — reuse the existing progress-bar rendering pattern, do not invent a new one.**
`ComparisonResultsView.tsx:56,73-83` already establishes the pattern this codebase uses for
"loading with a progress readout": `showProgress = loading && progress.phase !== "" && progress.total > 0`
→ render `<ProgressBar phase current total pct />` (`src/ui-kit/components/ProgressBar.tsx`);
otherwise render the existing `Loader2` spin icon with a phase-text label (indeterminate state, no
known total). Every new loading UI in this mission (`CsvUploader`, `ShapefileUploader`,
`CatalogTreeSelector`) follows this same conditional — same component, same gating expression
shape, not a new one per file.

**D3 — the yield primitive is `await new Promise<void>((resolve) => setTimeout(resolve, 0))`,
called periodically inside the parse loops.** Not `requestAnimationFrame` (unavailable under
Vitest's `environment: "node"`, and only fires while the tab is visible/painting — irrelevant here,
the goal is freeing the event loop for input/paint, which a macrotask boundary already does) and not
a Web Worker (bigger blast radius, new build/bundling surface, not needed — chunked yielding is
sufficient to keep the main thread responsive). Put this in one small shared helper, e.g.
`src/core/common/mainThreadYield.ts` exporting `yieldToMainThread(): Promise<void>`, used by both
`CsvParser` and `ShapefileParser` — do not duplicate the `setTimeout` line in each file.

**D4 — chunk size is a named constant, not a magic number.** Add it alongside the existing parsing
caps in `src/core/constants/mapConstants.ts` (where `MAX_MAP_PREVIEW_FEATURES` already lives) —
e.g. `PARSE_PROGRESS_CHUNK_SIZE = 2000`. Every `chunkIndex % PARSE_PROGRESS_CHUNK_SIZE === 0` check
calls `onProgress` then `await yieldToMainThread()`. One shared constant for both parsers unless you
find a concrete reason CSV rows and shapefile records need different chunk sizes — if so, name both
explicitly and say why in your report.

**D5 — `parse()` gains an optional trailing `onProgress?: ProgressCallback` parameter on both
`CsvParser` and `ShapefileParser`, and on the shared `ISpatialFileParser` interface
(`src/core/types/parsers.ts`) they implement.** Optional and backward compatible: every existing
caller that does not pass it keeps compiling and behaving exactly as today (confirm
`src/components/tools/file-viewer/FileViewerUploader.tsx`, the third consumer of these parsers,
still compiles and runs unchanged — it is not required to grow a progress UI in this mission, just
not to break).

**D6 — `BinaryDbfReader`'s field/record parsing gets the same chunked-yield treatment only if you
confirm its cost actually scales with record count.** Read it before deciding. If it is
proportional to `recordCount` (a per-record loop), treat it the same as `buildRecordIndex` and the
feature-extraction loop. If it is bounded by field count / header size only, leave it untouched and
say so in your report — do not add yielding to work that is not the freeze's cause.

**D7 — download progress covers the browser-to-our-API hop only, not the external CKAN fetch
itself.** `fetchCatalogFile` (`watcherClient.ts:107-125`) gains an optional trailing
`onProgress?: ProgressCallback` parameter. Read the response via `response.body!.getReader()` in a
loop, decode nothing (this is binary), track `receivedBytes` against the `Content-Length` header
(already set server-side at `handlers.ts:192`) if present; call
`onProgress("Descargando archivo del catálogo...", receivedBytes, totalBytes)` per chunk, with
`totalBytes = 0` when `Content-Length` is absent (the UI's D2 gating already renders the
indeterminate state correctly in that case). Reassemble the received chunks into the `Blob`/`File`
exactly as today — do not change the returned type or the filename-resolution logic at
`watcherClient.ts:120-124`.

**Do not touch `CkanPortalClient.ts`, `VaultStorageService.ts`, or the response construction in
`handlers.ts`.** True end-to-end streaming from the external CKAN portal through our API to the
browser in real time (a tee'd pass-through stream) is a materially bigger architectural change —
note it in your report as a follow-up, do not build it now. The server-side wait before headers
arrive will render as the indeterminate phase from D7/D2; that is the accepted, honest behavior for
this mission, not a bug to chase further.

**D8 — `CatalogTreeSelector.tsx` wires its own download progress into its own local UI**, next to
the resource button that is loading (not threaded through `onSelectFile`/`processFile` — that
boundary stays exactly as it is; the uploader components only ever receive the finished `File`).
Use the D2 pattern at the scale that fits a tree row — a compact `ProgressBar` or equivalent inline
phase+pct text is fine; keep it a small, self-contained piece of UI, not a new abstraction shared
across files that do not need it.

**D9 — `CsvUploader`/`ShapefileUploader` replace their static `Loader2` + fixed-label loading block
(`CsvUploader.tsx:140-145`, `ShapefileUploader.tsx:136-142`) with the D2 pattern**, fed by the
parser's `onProgress`. Track a `progress: ComparisonProgress`-shaped state
(`{phase, current, total, pct}` — the type already exists at
`src/core/types/comparison.ts:129-134`, reuse it) local to each component, initialized to an
indeterminate "Leyendo archivo..." phase before the parser's first callback fires.

## Explicitly out of scope

- `CkanPortalClient`, `VaultStorageService`, `handlers.ts` response construction (D7 note).
- Web Workers / offloading parsing off the main thread — chunked yielding is the chosen fix.
- Any change to `MAX_MAP_PREVIEW_FEATURES`, `BinaryShpReader`'s/`BinaryDbfReader`'s public method
  signatures beyond what D5/D6 require, projection/geometry math, `ZipShapefileExtractor`.
- `ComparisonResultsView.tsx`, `DatabaseStreamReader.ts`, or any DB-comparison progress plumbing —
  already correct, referenced only as the pattern to copy.
- New progress UI in `FileViewerUploader.tsx` — must keep compiling and working, does not need to
  gain a progress bar in this mission.
- Playwright coverage for the new progress UI. Real evidence here is the unit tests below; do not
  attempt to make a Playwright fixture large enough to observably chunk — likely flaky, not worth
  the risk in this mission.
- The `feat/viewport-windowed-map-rendering` branch's outstanding fabricated-telemetry correction
  (see the mission above this one). Unrelated thread, not touched here.

## Tests required

- `CsvParser`: `onProgress` is invoked with strictly increasing `current` across multiple chunks for
  a row count that spans several `PARSE_PROGRESS_CHUNK_SIZE` boundaries, and the final call reports
  `current === total`. `parse()` still resolves correctly and all existing `CsvParser.test.ts` /
  `CsvParserRecordAliasing.test.ts` assertions remain unchanged when `onProgress` is omitted.
- Prove the loop actually yields, not just reports: a test using fake timers (or a `setTimeout` spy)
  showing the parse promise does not resolve until the scheduled macrotask yields are flushed.
- `ShapefileParser`: same shape — `onProgress` fires across `buildRecordIndex` and the
  feature-extraction loop for a record count spanning multiple chunks, final call reaches the true
  total, and `isLargeDataset`/preview-cap behavior is provably unchanged.
- `fetchCatalogFile`: a test with a mocked `Response` whose `body` is a `ReadableStream` emitting
  known chunk sizes plus a `Content-Length` header — assert `onProgress` calls carry correct
  `current`/`total` and the final `File`'s bytes and filename are unchanged from today. A second
  test for the no-`Content-Length` path: `onProgress` called with `total === 0`, function still
  resolves correctly.
- `yieldToMainThread`: trivial unit test that it resolves after a macrotask tick.

## Rules that bind this work

`AGENTS.md`, `.agents/rules/coding_guidelines.md`, `.agents/rules/module_authoring.md`,
`.agents/rules/testing_standards.md`, `.agents/rules/code_review_standards.md`.

## Definition of done

Full gauntlet green, real output pasted into `.agents/handoff/TO_ORCHESTRATOR.md`:

```
npm run modules:routes:check
npm run lint
npm test
npm run build
npm run doctor
```

(`test:e2e` unaffected by this mission per the out-of-scope note above — run it anyway and confirm
the existing 23 specs still pass unchanged, since the uploader loading-state markup is changing.)

State plainly: the D6 `BinaryDbfReader` decision and why, the final chunk-size constant(s) chosen,
and confirm `FileViewerUploader.tsx` still compiles and works untouched.

Do not commit.

---

# Fix round 1 — one implementer defect, one gap in my own plan

Round 1 of 3. Gauntlet re-run independently by a fresh-context `code-reviewer`, genuinely green:

```
> npm run modules:routes:check   → Generated module routes are up to date (7 route file(s))
> npm run lint                   → 0 errors, 0 warnings
> npm test                       → Test Files 34 passed (34), Tests 353 passed (353)
> npm run build                  → Compiled successfully, TypeScript clean, 18 routes generated
> npm run doctor                 → No issues found!
```

(`test:e2e` was not independently re-run this round — the reviewer judged the change surface small
enough and time-boxed the review; if you touch any uploader/tree markup while fixing the items
below, re-run it yourself and paste real numbers before reporting done.)

`doctor`'s score readout came back as "Score unavailable (could not reach the score API)" this run
instead of the "100/100" your report claimed — the substantive check ("No issues found!") still
passed both times, so this reads as the score API being flaky/unreachable in this environment, not
a regression. Not an action item, noting it so the discrepancy isn't silently dropped.

Everything else holds: `ProgressCallback` reused from `src/core/types/comparison.ts` (not
redeclared, D1 honored), the D2 progress-bar pattern followed consistently in `CsvUploader` /
`ShapefileUploader` / `CatalogTreeSelector`, the CSV/Shapefile parser yield-gating is correct at
every chunk boundary (verified against 2000/2050/2100-row/feature test cases, no double-fire, no
skipped terminal callback), the streaming download's chunk accumulation / `Content-Length`
handling / blob-fallback / error paths are all correct, `FileViewerUploader.tsx` is untouched and
still compiles, D6's `BinaryDbfReader` no-op is correctly justified, and the `CsvParser.test.ts`
diff is purely additive — no weakened or deleted assertion anywhere in the test diff.

## M1 [MAJOR] — unrelated doc comments deleted from `mapConstants.ts`

`src/core/constants/mapConstants.ts:95-100` (current file). The diff against `main` deletes the
multi-line rationale comments that stood above `MAP_MICRO_CHUNK_SIZE`, `MAX_MAP_PREVIEW_FEATURES`,
`MAX_VIEWPORT_RENDER_FEATURES`, `VIEWPORT_INDEX_PADDING_RATIO`, and
`SPATIAL_INDEX_TARGET_FEATURES_PER_CELL` — none of which this mission touches otherwise. Those
constants belong to the unrelated ISSUE_030 viewport-windowing feature (consumed by
`ViewportFeatureIndex.ts`, `SpatialMapPreview.tsx`, `useVectorChunkStream.ts`,
`useViewportFeatureWindow.ts`, `useLeafletMap.ts`) and were written deliberately, one round at a
time, across that mission's own review cycle (see `MAX_MAP_PREVIEW_FEATURES`'s comment above — it
recorded the exact 1,051,248-feature / 2.5GB measurement from
`BINARY_SHAPEFILE_1M_OPTIMIZATION.md` and its proportional scaling to the 150,000 cap;
`SPATIAL_INDEX_TARGET_FEATURES_PER_CELL`'s comment recorded the grid-dimension clamp formula). This
is exactly the "critical, non-obvious context" `AGENTS.md` reserves comments for, and it is now
gone for no reason connected to this mission's scope.

**Failure scenario:** not a runtime bug — a documentation loss. The next engineer who needs to
retune `MAX_MAP_PREVIEW_FEATURES` or `SPATIAL_INDEX_TARGET_FEATURES_PER_CELL` has no comment
pointing them at the measurement or the formula that justified the current value, and has to
re-derive it or go spelunking through `BINARY_SHAPEFILE_1M_OPTIMIZATION.md` and the ISSUE_030
thread in this same file to recover what used to be one comment away.

**Fix:** restore the five deleted comment blocks exactly as they were on `main`
(`git show main:src/core/constants/mapConstants.ts` has them), then add `PARSE_PROGRESS_CHUNK_SIZE`
with its own one-line comment underneath, touching nothing else in the file.

## M2 [MAJOR] — download progress has no throttle, unlike every parse loop in this same mission

**This one is mine, not yours.** D7 of the original brief said "call `onProgress(...)` per chunk"
without specifying a throttle, while D4 explicitly gated the parser loops on
`PARSE_PROGRESS_CHUNK_SIZE`. You implemented D7 exactly as written — the gap is in the plan, not
the execution.

`src/modules/cartography-watcher/ui/watcherClient.ts:126-146` (`fetchCatalogFile`'s streaming
loop) calls `onProgress` on every single `reader.read()` resolution, no count/byte gate. Consumed
by `CatalogTreeSelector.tsx:161-172`'s `setDownloadProgress` inside `selectFileMutation`, with no
memoization on `CatalogResourceRow`/`CatalogGroup`. Confirmed by your own test
(`tests/unit/modules/cartography-watcher/fetchCatalogFile.test.ts:52`): two enqueued chunks produce
two `onProgress` calls, by design — one `setState` per network chunk, unconditionally.

**Failure scenario:** a 100–200MB catalogue shapefile downloaded over a fast/local connection
arrives as hundreds to several thousand `ReadableStream` chunks (typical browser chunk sizes are
tens of KB). Each one forces a re-render of the whole catalog tree. Because each `await
reader.read()` resumption is a separate task/microtask boundary, React doesn't collapse these into
one paint — this reintroduces exactly the kind of main-thread churn this mission exists to
eliminate, just moved from parsing to downloading.

**Fix:** gate `onProgress` in the download loop the same way the parsers gate theirs — fire on a
byte-interval or every Nth chunk, plus one unconditional final 100% call (same shape as
`PARSE_PROGRESS_CHUNK_SIZE`'s pattern; reuse that constant or a byte-based sibling, your call, name
it and say why). This also absorbs a minor duplicate-call artifact at
`watcherClient.ts:141-146`: when `Content-Length` is known, the last loop iteration already reports
`current === total` and the unconditional post-loop block fires an identical call again — a
correctly-throttled version naturally collapses to one terminal call, so no separate fix needed
there once M2 lands.

## Rejected — do not implement

- **Extracting `CsvUploader`/`ShapefileUploader`'s `ParseProgress` interface and progress-handling
  block into a shared hook.** Both already reuse the pre-existing `ProgressBar` component
  (`src/ui-kit/components/ProgressBar.tsx`, already shared with `ComparisonResultsView.tsx` /
  `SqlExecutionProgress.tsx`) — the ~15 duplicated lines are a small parallel conditional and a
  percentage-calc closure, not duplicated presentation logic, and mirror this codebase's
  established pattern of parallel-but-separate CSV/Shapefile upload components (the same pattern
  the wizard-steps mission explicitly declined to collapse for the analogous three sync wizards).
  Not worth a fix round.

## Definition of done for this round

Gauntlet green again, real output pasted: `modules:routes:check`, `lint`, `test`, `build`, `doctor`.
If you touched any uploader/catalog markup while fixing M2, re-run `test:e2e` and paste real
numbers. 353 existing tests byte-identical; only additions for M2's new throttling behavior (assert
the call count no longer scales 1:1 with chunk count, and that the terminal call still reports
100%). Report M1 and M2's resolution plainly.

Do not commit.

---

# Round 2 review — approved with one non-blocking note

Gauntlet re-run independently by a fresh-context `code-reviewer`, genuinely green:

```
> npm run modules:routes:check   → Generated module routes are up to date (7 route file(s))
> npm run lint                   → 0 errors, 0 warnings
> npm test                       → Test Files 34 passed (34), Tests 354 passed (354)
> npm run build                  → Compiled successfully, TypeScript clean, all routes generated
> npm run doctor                 → No issues found! (score API unreachable again — same
                                     environmental flakiness noted last round, not a regression)
```

`test:e2e` not re-run this round — no uploader/catalog markup changed beyond what the prior 23/23
pass already covered.

**M1 — accepted, not restored.** The claimed user override was confirmed directly with the user
this round: they gave that instruction to the implementer session personally. The comments in
`mapConstants.ts` stay deleted. Independently of the override, the domain-separation refactor
(`PARSE_PROGRESS_CHUNK_SIZE` → `src/core/constants/parserConstants.ts`,
`DOWNLOAD_PROGRESS_BYTE_INTERVAL` → `src/modules/cartography-watcher/constants.ts`) was verified
sound: correct exports, correctly consumed, no circular imports, no stale imports of the old
location. Closed.

**M2 — fully resolved, verified by independent boundary-math derivation, not just re-reading the
description.** The `lastReportedBytes` throttle in `fetchCatalogFile`
(`watcherClient.ts:126-166`) was traced by hand across four cases — multi-chunk with known total,
single-chunk with known total, and both of those with `Content-Length` absent — with no double-fire
and no skipped terminal call in any of them. The new test's 10×10KB-chunks-against-a-64KB-threshold
scenario was independently re-derived (fires at 10KB, 80KB, terminal 100KB = 3 calls) and matches
the test's own assertions exactly, not just trusted at face value. Closed.

## N1 [MINOR] — download progress reports 100% on every throttled tick when Content-Length is absent

`watcherClient.ts:151-160`. When the server omits `Content-Length` (`totalBytes = 0`), every
throttled `onProgress` call reports `total: receivedBytes` — i.e. `current === total` on every
single fire, not only the last one. `CatalogTreeSelector.tsx:73` computes
`Math.round((current/total)*100)` from this, so the badge reads "100%" at every intermediate
throttle point during such a download, never showing genuine partial progress until the download
actually finishes.

**Pre-existing, not introduced this round** — present in the original streaming implementation
before M1/M2 even existed as findings, confirmed by re-checking the base-mission diff. Not part of
M1/M2's scope and not gating this round's closure. Logged here so it isn't lost: worth a follow-up
if CKAN's file endpoint is ever observed omitting `Content-Length` in practice (it currently always
sets it server-side per the original mission brief's D7, `handlers.ts:192`, so this may be
purely theoretical today).

## Status

Mission complete. No BLOCKER or MAJOR findings remain open. M1 and M2 both closed. N1 logged as a
non-blocking follow-up candidate, not required before commit. Ready for the user's explicit commit
instruction — implementer and orchestrator do not commit on their own.

Do not commit.

---

# Mission — fix the discrepancy map's viewport fit racing a hidden (zero-size) tab

> New, independent mission. Unrelated to the catalog-download-progress branch above — cut fresh
> from `main`, not from that branch. The user reported this directly, live, with a screenshot.

**Branch**: `fix/discrepancy-map-hidden-container-viewport-fit`, cut from `main`.
**Note**: `npm` is not on PATH — prepend `C:\Alekos\Tools\node24portable` per
`.agents/rules/portable_node.md`.

## The bug, as diagnosed by the orchestrator (do not re-investigate the root cause)

User report: on the discrepancy map (`ComparisonResultsView.tsx`'s "Mapa de Discrepancias
Espaciales" tab), not all features are visible at once — what renders changes depending on pan/zoom.
Expected: this map has an explicit "never capped" contract (`ComparisonResultsView.tsx:143-146`) —
every feature that reaches it must be able to render, full stop.

**Root cause: the viewport-windowing hook computes its very first camera fit and render-window
query against a hidden, zero-size map container, and never gets a chance to correct itself.**

- `ComparisonResultsView.module.css:124-126` — `.tabHidden { display: none !important; }`. The map
  panel is wrapped in this class whenever `activeViewTab !== ResultsViewTab.MAP`
  (`ComparisonResultsView.tsx:132`). Default active tab is `TABLE`
  (`ComparisonResultsView.tsx:52`), so the map panel — and the `SpatialMapPreview` inside it — is
  mounted in the DOM, but zero-size and hidden, until the user clicks the Map tab.
- `useMapInstance.ts:13-29` constructs the real Leaflet map (`L.map(mapContainerNode,
  {...}).setView([-32.5, -56.0], 7)`) as soon as the container div exists in the DOM — regardless
  of whether it is visually hidden. `isMapReady` becomes `true` at this point even though the
  container may be 0×0.
- `useViewportFeatureWindow.ts`'s effect (lines 46-124) only gates on `isMapReady` and the
  `geojson` identity — it has **no concept of tab visibility**. The very first time it runs (as
  soon as `isMapReady` flips true, which can happen while the Table tab is still active), it:
  1. Builds the spatial index and calls `mapInstance.fitBounds(bounds, { padding: [30, 30] })`
     (lines 60-68) against a container that may have zero width/height — Leaflet cannot compute a
     meaningful fit against a zero-size container, so this effectively no-ops, leaving the map at
     its hardcoded default view.
  2. Immediately calls `updateWindow()` (line 115), which reads `mapInstance.getBounds()`
     (line 82) — reflecting that same broken/default viewport — and queries the spatial index
     against it, producing a small, essentially arbitrary windowed subset.
  3. That bad bbox is cached in `previousWindowBBoxRef` (line 104) and becomes the baseline for
     every subsequent `moveend`/`zoomend`-triggered `updateWindow()` call. Nothing ever re-triggers
     the initial full-extent fit, because the effect's dependency array
     (line 124: `[mapInstanceRef, geojson, isMapReady, maxRenderFeatures]`) has nothing that
     changes when the tab is later revealed.
- Contrast with the sibling hook `useVectorChunkStream.ts`, which **is** visibility-aware
  (`isVisible` param, guard at lines 71-73) and calls `mapInstance.invalidateSize()` before
  rendering (lines 97, 126) — this correctly fixes the map's *rendering* geometry once the tab
  becomes visible, but it has no way to fix the *windowing* hook's already-wrong cached bbox.
  `useLeafletMap.ts:32-37` calls `useViewportFeatureWindow` **without** passing `isVisible` at all
  — the parameter isn't threaded to it, even though `useLeafletMap` already receives `isVisible`
  as its own parameter (line 18) and does thread it into `useVectorChunkStream` (line 48).

This is why the symptom is exactly "depending on zoom I see different things, never everything at
once": the user's own manual pan/zoom is the only thing ever recomputing the window from that point
on, but the one computation that was supposed to capture the full dataset extent ran against a
broken container and never happened correctly.

Confirmed this is not caused by the catalog-download-progress branch — none of that branch's files
touch `useViewportFeatureWindow.ts`, `useMapInstance.ts`, `useLeafletMap.ts`, or
`ComparisonResultsView.tsx`.

**Separate, unconfirmed observation — not part of this mission's scope, flagged for the user's
awareness only:** the map header badge read "26 entidades" against a "Tabla de Discrepancias
15.424" count in the screenshot that prompted this report. That gap may be entirely legitimate
(most discrepancy types may not carry geometry — see `useDiscrepancyGeojson.ts`'s
`createDiscrepancyFeatures`, which only emits a feature when `dbRecord`/`shpGeometry` actually
resolve to a geometry), or it may be a second, independent bug in geometry resolution. Do **not**
investigate or touch `useDiscrepancyGeojson.ts` in this mission — it's undiagnosed, unrelated to
the fit/windowing defect above, and needs its own root-cause pass with real data if the user
confirms the count still looks wrong after this fix lands.

## Binding decisions

**D1 — `useViewportFeatureWindow` becomes visibility-aware, mirroring the exact pattern already
established in `useVectorChunkStream.ts`.** Add an `isVisible: boolean = true` parameter
(default `true` preserves current behavior for every consumer that doesn't pass it — see D4). Guard
the top of the effect: while `!isVisible`, return immediately, same shape as
`useVectorChunkStream.ts:71-73`. Add `isVisible` to the effect's dependency array
(currently line 124).

**D2 — call `mapInstance.invalidateSize()` before any bounds-dependent computation, every time the
effect actually proceeds** (i.e., after the `isMapReady`/`isVisible` guards pass) — not just on the
first run. This mirrors the established pattern already used at
`useLeafletMap.ts:61` (`handleFitBounds`) and `useVectorChunkStream.ts:97,126`. Do the math
yourself before committing to placement: `invalidateSize()` must run *before* the `fitBounds()` call
in the first-time-index-build branch (lines 60-68) and *before* `mapInstance.getBounds()` inside
`updateWindow` (line 82), since both depend on Leaflet's internal container-size cache being
correct at that moment.

**D3 — do not change *when* the one-time `fitBounds`-to-full-extent runs relative to dataset
identity.** The existing `lastProcessedGeojsonRef.current !== geojson` check (line 53) must remain
the only gate for "is this a new dataset" — do not also re-fit every time the tab is merely
revisited with the *same* dataset (e.g., user switches Table → Map → Table → Map again). Because
the effect currently returns early while `!isVisible` (D1), and only reaches the
`lastProcessedGeojsonRef` check once it actually proceeds, this falls out naturally: the ref stays
`null` while the map is hidden, so the first time the effect runs while visible, it correctly
detects "new" and fits + builds the index exactly once. A second tab revisit (same geojson,
`isVisible` flips true again) must **not** re-run `fitBounds` — it should only recompute the window
against whatever the current camera position already is. Do not add extra state to special-case
this beyond what the existing ref check already provides.

**D4 — thread `isVisible` through `useLeafletMap.ts` into `useViewportFeatureWindow`, unchanged for
every other caller.** `useLeafletMap.ts` already receives `isVisible` (line 18, default `true`) and
already forwards it to `useVectorChunkStream` (line 48) — add the same forwarding to the
`useViewportFeatureWindow` call (lines 32-37). Every consumer of `SpatialMapPreview` other than
`ComparisonResultsView.tsx` (`CsvUploader.tsx`, `LoadedShapefileCard.tsx`,
`DbTableViewerContainer.tsx`, `FileViewerContainer.tsx`) never passes `isVisible` at all, so it
stays `true` throughout their lifecycle — confirm none of them wrap `SpatialMapPreview` in a
CSS-hidden tab (verified: they don't), so this change must be a complete no-op for all four.

## Explicitly out of scope

- `useDiscrepancyGeojson.ts` / geometry-resolution logic. Undiagnosed, separate concern (see note
  above) — do not touch.
- `ViewportFeatureIndex.ts`, `ViewportWindowPlanner.ts` — pure, already correct, already covered by
  passing unit tests. Not the defect.
- `neverCapViewportRender` / `maxRenderFeatures` / the density-cap wiring — already correct, verified
  across three prior review rounds on the viewport-windowing mission. Not the defect.
- The `.tabHidden { display: none }` pattern itself, or switching to conditional mounting instead of
  CSS-hidden — a larger, riskier change than needed; the fix belongs entirely inside the windowing
  hook's own lifecycle awareness.
- Adding a persistent "you're seeing N of M features" UI indicator for the discrepancy map (today
  there is genuinely no such signal once chunking finishes, since the static cap-notice banner is
  driven by `maxFeatures`, which is `null` here). Worth a follow-up, not required to fix this bug.
- The catalog-download-progress branch and its findings. Unrelated thread.

## Required test coverage

Hooks are not unit-testable in this project's Vitest setup (`environment: "node"`, no `.tsx`
collection — the same reason the viewport-windowing mission's own hooks were left as "thin,
untested adapters" per its original D4). This bug only manifests with real browser layout (a
hidden→visible tab transition), so verification is Playwright + manual, matching how the original
viewport-windowing mission's own G1/G2 rounds were verified.

1. **Playwright regression** in `tests/e2e/flows/comparison-results.spec.ts`, extending the existing
   map-tab test ("debe alternar a la pestaña de Mapa..." around line 197). Use fixture discrepancy
   items whose geometries are spread far enough apart (e.g., one point near Rivera, one near
   Montevideo/Buenos Aires — check `tests/e2e/fixtures/` for what's already available or extend it)
   that a viewport still anchored to the hardcoded default (`[-32.5, -56.0]`, zoom 7) would only
   catch a subset, while a correct full-extent fit would catch all of them. Prove the fix
   specifically: switching directly from Table to Map on first visit (no manual pan/zoom, no
   clicking "Ajustar vista a los límites de la capa") must render every fixture feature — pick
   whatever concrete, stable assertion actually distinguishes "correctly fit to full extent" from
   "stuck at the default view" (e.g., surface the rendered/total counts in a way the test can read
   reliably once chunking settles, or assert on the map's actual bounds via `page.evaluate` if a
   test hook can reach the Leaflet instance) — the mechanism is your call, but it must be able to
   fail against the bug as described above, not just check that the map container is visible (the
   existing test already does that and did not catch this).
2. Add a second case in the same spec: Table → Map → Table → Map (revisit with the same dataset).
   Assert the fix does not re-trigger an unwanted re-fit that would discard a user's manual pan —
   i.e., confirm D3 holds (this can be a lighter assertion; the point is proving no regression from
   the `isVisible`-gated re-run).
3. **Manual verification required, reported with real observations, not just gauntlet numbers**
   (this project's history has twice rejected fabricated/skipped manual-verification claims on this
   exact map — see the "Round 3 Review" and "Fix Round 1"/"Fix Round 2" entries for the
   viewport-windowed-map-rendering mission earlier in this file. Do not repeat that mistake). Run
   `npm run dev`, load a real comparison result with discrepancies spread across a wide area, land
   on the Table tab (the default), click directly into the Map tab, and report plainly whether every
   expected marker appears immediately without needing to touch "Ajustar vista" or pan/zoom
   manually. If you cannot reach a live comparison result in this environment (no DB), say so
   explicitly instead of fabricating a session — the Playwright fixture-based test above is the
   primary evidence in that case.

## Rules that bind this work

`AGENTS.md`, `.agents/rules/coding_guidelines.md`, `.agents/rules/testing_standards.md`,
`.agents/rules/code_review_standards.md`.

## Definition of done

Full gauntlet green, real output pasted into `.agents/handoff/TO_ORCHESTRATOR.md`:

```
npm run modules:routes:check
npm run lint
npm test
npm run build
npm run doctor
npm run test:e2e
```

All existing tests pass unchanged (no existing assertion altered — this is purely additive).
Playwright spec count only goes up. Report plainly: the D1-D4 decisions honored, the manual
verification outcome (or explicit statement that it could not be performed and why), and confirm
the four non-tab-hidden `SpatialMapPreview` consumers are behaviorally unaffected.

Do not commit.

---

# Fix round 1 — D1-D4 are correct; the self-found second bug was fixed the wrong way

Round 1 of 3. The user asked for an especially thorough pass this round, specifically on
suppression directives, dead code, God-component drift, and clean-architecture. Two independent
reads (the orchestrator's own, and a fresh-context `code-reviewer` subagent that re-ran the full
gauntlet including `test:e2e`) agree on both findings below.

```
> npm run modules:routes:check   → up to date (7 route file(s))
> npm run lint                   → 0 errors, 0 warnings
> npm test                       → 34/34 suites, 355/355 tests
> npm run build                  → clean Turbopack build
> npm run doctor                 → 100/100, No issues found!
> npm run test:e2e               → 24/24 specs passing, including both new ones
```

**D1-D4 (the actual mission) are correct, proportionate, and match the brief exactly** — verified
line-by-line in `useViewportFeatureWindow.ts` and `useLeafletMap.ts`. No `eslint-disable`,
`react-doctor-disable`, `@ts-ignore`, or `@ts-expect-error` exists anywhere in this diff — checked
directly, not inferred, since the user specifically asked this be verified rather than assumed.

**The self-found second bug is real and legitimate to fix here, not scope creep.** You discovered
that `discrepancyGeojson` returning `null` off-tab (`useDiscrepancyGeojson`'s existing lazy-eval
gate) was unmounting `SpatialMapPreview` on every tab switch, directly contradicting the code's own
comment ("Preserved in DOM to eliminate 500k layer teardown overhead") and undermining D3 (there's
no ref state to preserve across a real unmount/remount). Good catch — this was a genuine gap in the
original brief, not something you should have left alone. But the *implementation* of the fix has
two real problems.

## Q1 [MAJOR] — the caching block reinvents `useMemo` badly and silently drops the lazy-eval guarantee

`ComparisonResultsView.tsx:60-88`. `rawDiscrepancyGeojson = useDiscrepancyGeojson(...)` is called
**unconditionally on every render**. `useDiscrepancyGeojson` (`src/hooks/useDiscrepancyGeojson.ts`)
is a plain function with no internal memoization — it only short-circuits in O(1) when
`isMapActive` is `false`; otherwise it runs `buildDatasetGeometryMap` +
`summary.items.filter().flatMap(createDiscrepancyFeatures)` synchronously, every call. Because
`isMapActive = hasActivatedMap || activeViewTab === MAP` and `hasActivatedMap` latches `true`
forever after the first Map-tab visit, `isMapActive` never goes back to `false` — so this full scan
now runs on **every** re-render for the rest of the component's life, even while parked on the
Table tab. The surrounding `cachedSnapshot`/`setState` block only decides whether to *keep* the
freshly computed result; it does nothing to stop the expensive computation from running in the
first place.

**Failure scenario:** a comparison result with 15k+ items (the scale this exact codebase's own bug
reports cite). User visits the Map tab once, returns to Table, then clicks through several KPI
filter cards. Each click changes `activeFilter` → re-render → the full filter/flatMap over every
item runs again on the main thread, even though the result is immediately discarded because the tab
isn't visible. This did not happen before this diff — previously `isMapActive` reverted to `false`
on tab switch and the hook short-circuited instantly. This is a newly-introduced regression, not a
pre-existing one.

This also piles more state onto `ComparisonResultsView.tsx`, which a prior planning pass already
flagged as a real (separate, not-yet-scheduled) God-component decomposition target — two more
`useState`s and a hand-written 4-field dependency comparison move that file in the wrong direction.

**Required fix**, verified to compile against the real types: keep `isMapActive = activeViewTab ===
ResultsViewTab.MAP` exactly as it was originally (true tab-active laziness — the hook must
short-circuit instantly off-tab, restoring the original comment's literal guarantee, "Lazy-evaluated
only when Map tab is active"). Separately, cache the *last non-null result* in a ref — the same
pattern this codebase already uses (see `lastProcessedGeojsonRef` inside
`useViewportFeatureWindow.ts` itself, one file away):

```ts
const lastNonNullGeojsonRef = useRef<FeatureCollection | null>(null);
if (rawDiscrepancyGeojson !== null) {
  lastNonNullGeojsonRef.current = rawDiscrepancyGeojson;
}
const discrepancyGeojson = hasActivatedMap ? lastNonNullGeojsonRef.current : null;
```

Keep `hasActivatedMap` (it's still needed, and still correct) — delete `cachedDiscrepancyGeojson`
and `cachedSnapshot` entirely. One ref, the state you already had, zero extra render passes, and the
original laziness guarantee is restored instead of silently weakened.

## Q2 [MAJOR] — `window.__gis_leaflet_map` is an ungated production global, inconsistent with this same diff's own `data-*` pattern

`useMapInstance.ts:28-30,48-50`. The live Leaflet map instance is assigned to
`window.__gis_leaflet_map` unconditionally on every mount (nulled on unmount) in production code —
no `NODE_ENV` gate, no build-time stripping. Every real user's browser now carries a live, mutable
reference to the app's internal map instance on `window`, reachable by any script running on the
page, purely to support two Playwright specs. This is inconsistent with the *same diff*'s own
better answer to the same problem: `data-rendered-count` on `SpatialMapPreview`'s container
(`SpatialMapPreview.tsx:131`) is a zero-footprint, production-safe test hook — grep confirms it's
the only other test-hook convention anywhere in `src/`, and this diff didn't follow its own
precedent for the camera-position assertions.

**Required fix — the minimum bar, not optional:** gate the assignment so it never reaches
production users: `if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") { ... }`
on both the set (mount) and the clear (unmount) sites.

**Also fix while touching this code:** `useMapInstance.ts:48-50`'s cleanup nulls the global
unconditionally, without checking it still points at *this* instance's map — if two
`SpatialMapPreview`s ever mounted concurrently, the one that unmounts last would clobber the other's
live reference. Not currently reachable (verified: `WizardOrchestrator.tsx` renders only one active
step's content at a time, and each tool lives on its own route, so no live path produces two
concurrent instances today) — but cheap to make correct while you're already editing these four
lines: only clear the global if `window.__gis_leaflet_map === map` at cleanup time.

**Not required this round, noted for completeness:** a stronger alternative would drop the global
entirely — pair `data-center-lat`/`data-center-lng` read-only attributes (matching
`data-rendered-count`'s pattern) with a real simulated Leaflet drag/wheel-zoom interaction in
Playwright instead of `page.evaluate(() => ...setView(...))` for the write path. That's a larger,
more brittle test-authoring change for marginal benefit over a `NODE_ENV`-gated global — do not do
this now; the gate above is sufficient.

## Rejected — do not implement

Nothing rejected this round. Both findings were independently confirmed by a second reviewer with
its own fresh gauntlet run, including `test:e2e`.

## Definition of done for this round

Gauntlet green again, real output pasted, **including `test:e2e`** — this fix is specifically about
browser-layout behavior and the two new specs are the primary evidence for it, do not skip. Confirm
the two new Playwright tests still pass unchanged after Q1's refactor (they assert observable
behavior — rendered count and camera latitude — not the internal caching mechanism, so they should
not need to change). No existing assertion altered. Report Q1 and Q2's resolution plainly, and
re-confirm `eslint-disable`/`react-doctor-disable`/`@ts-ignore`/`@ts-expect-error` count is still
zero across the full diff.

Do not commit.

---

# Round 2 — Q1 implemented directly by the orchestrator, not delegated

The user was unhappy with two implementer attempts at Q1 (both reinvented the same over-engineered
two-`useState`-plus-manual-diff shape under different names) and told the orchestrator to fix it
directly rather than write a third brief. This round documents that direct edit for the record —
it did not go through the implementer, per the user's explicit instruction overriding the normal
delegation rule for this one change.

**Q1 — resolved.** `ComparisonResultsView.tsx`'s cache collapsed to a single
`useState<{summary, fileDataset, activeFilter, geojson} | null>`, comparing exactly the three real
upstream dependencies (not `rawDiscrepancyGeojson`'s own always-fresh reference — `useDiscrepancyGeojson`
is not internally memoized, confirmed untouched, its own test file's "calls no React hooks" invariant
still holds). `isMapActive` reverted to true tab-active laziness
(`activeViewTab === ResultsViewTab.MAP`), restoring the original "Lazy-evaluated only when Map tab is
active" guarantee — the expensive `summary.items.filter().flatMap()` scan no longer runs off-tab.

First attempt at this direct fix used a `useRef` mutated during render instead of `useState` — a
fresh-context reviewer caught that this trips the project's mandatory `react-hooks/refs` lint rule
and `react-doctor`'s matching check (both hard-fail gates per `testing_branch_workflow.md`), so it
was corrected to the `setState`-during-render shape before landing — same shape as the pre-existing
`hasActivatedMap` two lines above it. Also reverted an unrelated cosmetic rename
(`(moduleExports) => moduleExports.SpatialMapPreview` back to `(m) => m.SpatialMapPreview`) that had
no bearing on either fix.

**Q2 — already resolved** (confirmed untouched and correct: `window.__gis_leaflet_map` gated behind
`process.env.NODE_ENV !== "production"` on both mount and cleanup, with an ownership check on clear).

Gauntlet re-run independently after the correction, full green including `test:e2e`:

```
> npm run modules:routes:check   → up to date (7 route file(s))
> npm run lint                   → 0 errors, 0 warnings
> npm test                       → 34/34 suites, 355/355 tests
> npm run build                  → clean Turbopack build
> npm run doctor                 → 100/100, No issues found!
> npm run test:e2e               → 24/24 specs passing, both new specs unmodified and green
```

No `eslint-disable`, `react-doctor-disable`, `@ts-ignore`, or `@ts-expect-error` anywhere in the
diff. No BLOCKER/MAJOR/MINOR findings remain open on this mission.

## Status

Mission complete. Ready for the user's explicit commit instruction whenever they want it —
implementer and orchestrator do not commit on their own.

Do not commit.

---

# Round 3 — dropped the window test-hook global entirely, orchestrator-implemented

The user pushed back on `window.__gis_leaflet_map` (Round 2's Q2 fix) even gated behind
`NODE_ENV !== "production"` — asked "do we actually need this." Correct call: it wasn't needed.
Replaced by the orchestrator, directly, across `useMapInstance.ts` and the two Playwright specs:

- **Read path**: `data-center-lat`/`data-center-lng` dataset attributes on the map container,
  updated on Leaflet's own `moveend` event — same declarative convention as `data-rendered-count`,
  ungated (inert, ships in production same as that attribute already does).
- **Write path** (simulating a manual pan for the D3 test): a real Playwright mouse drag on the map
  container instead of calling `setView()` through the global — exercises the actual drag-handling
  code path a user triggers, not just Leaflet's internal API.

Took four sub-rounds to land clean, each caught by an independent gauntlet re-run:
1. First cut mutated `mapContainerNode.dataset` directly inside `useMapInstance.ts` — tripped
   `react-hooks/immutability` (mutating a hook's own parameter). Fixed by writing through
   `map.getContainer()` instead (a method-return value, not the raw argument).
2. `react-doctor/effect-needs-cleanup` still fired because the `moveend` listener had no explicit
   `.off()` paired with its `.on()`. Added one — but doctor kept failing across two more attempts
   because the `.off()` target used a *different* identifier than the `.on()` call (first a
   ref-of-ref, then a renamed `mapForCleanup` alias). Doctor's matcher pairs `.on`/`.off` by
   identifier, not by runtime aliasing — confirmed against the rule's own published doc and by
   diffing against the already-passing sibling `useViewportFeatureWindow.ts`, which uses one
   consistent name for both. Final shape: a single `let map` closure variable used identically at
   both call sites.
3. The rewritten D3 Playwright test (real mouse drag) failed because the drag's start coordinates
   were computed from `boundingBox()` while the map container sat below the viewport fold — the
   synthesized mouse events landed off-screen and never reached Leaflet. Fixed with
   `mapContainer.scrollIntoViewIfNeeded()` before reading the bounding box.
4. An `inertia: false` map option was added along the way as an attempted (and, per point 3, wrong)
   fix for test determinism — reverted; it changed real panning UX for every map consumer without
   being asked and didn't address the actual bug.

Also, per direct user feedback mid-round: stopped adding explanatory comments to these edits.
`CLAUDE.md`'s own formatting rule already says not to unless strictly critical — this was on the
orchestrator, not a missing rule.

Final gauntlet, independently re-run, fully green:

```
> npm run modules:routes:check   → up to date (7 route file(s))
> npm run lint                   → 0 errors, 0 warnings
> npm test                       → 34/34 suites, 355/355 tests
> npm run build                  → clean Turbopack build
> npm run doctor                 → 100/100, No issues found!
> npm run test:e2e               → 24/24 specs passing
```

No `window.__gis_leaflet_map` reference remains anywhere in the repo (grep-confirmed).

## Status

Mission complete. `TO_ORCHESTRATOR.md` and `docs/issues/ISSUE_032_...md` still describe the
now-removed `window.__gis_leaflet_map` approach and an earlier, briefly-red gauntlet state from
mid-round — stale, not corrected here (out of scope for a code fix round); update before treating
either doc as current status. Ready for the user's explicit commit instruction whenever they want
it.

Do not commit.


---

# Mission — `address-dedup` module (CGEO-2192 workflow ported to TypeScript)

> **SUPERSEDED — DO NOT IMPLEMENT THIS SECTION.** Replaced by "Mission (REVISED ... SQL as the
> engine)" further down this file. Kept for provenance only.

**Branch:** `feat/module-address-dedup`, cut from `main` (`git checkout -b feat/module-address-dedup main`).
**Do not commit. Do not push.** Leave the tree dirty for review.
**Node:** `npm` is not on PATH. Prepend `C:\Alekos\Tools\node24portable` to `$env:PATH`, or call
`C:\Alekos\Tools\node24portable\npm.cmd` directly (`.agents/rules/portable_node.md`).

## Binding rules (read first, in full)
`AGENTS.md`, `CLAUDE.md`, `.agents/rules/module_authoring.md` (the recipe, steps 1-8, hard rules),
`.agents/rules/coding_guidelines.md`, `.agents/rules/testing_standards.md`,
`.agents/rules/testing_branch_workflow.md`, `.agents/rules/code_review_standards.md`.
Reference module: `src/modules/cartography-watcher/` (manifest `manifest.ts`, handlers
`api/handlers.ts`, injectable orchestrator `services/WatcherOrchestrator.ts`, tests in
`tests/unit/modules/cartography-watcher/`).

## Background (self-contained)
A one-off investigation (ticket CGEO-2192, read-only SQL against production Postgres) found
duplicate addresses in `carto.v_address_build`, decided KEEP/REMOVE per row, and exported CSV /
GeoJSON for QGIS. We are turning that into a reusable, deletable module. Source of truth for the
logic is the v3 SQL, which you must port **faithfully**:
- `C:\Alekos\Tasks\CGEO-2192\prod\v3\find_removal_candidates.sql` (key + decision)
- `C:\Alekos\Tasks\CGEO-2192\prod\v3\find_infrastructure_matches.sql` (infra match context)
- `C:\Alekos\Tasks\CGEO-2192\TRACKER.md` (why every rule is the way it is, corrections #1-#11;
  read at least #4, #5, #7, #9, #10, #11)

## Scope: INVESTIGATION ONLY
The module reads and reports. **No endpoint, service or UI path may write to, update or delete from
any database.**

## Decisions (binding — do not revisit; raise a question in TO_ORCHESTRATOR.md instead)

**D1. It is a module** at `src/modules/address-dedup/` (`moduleId` `address-dedup`). Deletion set is
exactly: that folder, its line in `src/app/modules.registry.ts`, `tests/unit/modules/address-dedup/`,
plus generated routes under `src/app/api/m/address-dedup/**` (regenerated, never hand-edited). Nothing
in `core/` or `ui-kit/` may be changed except where D9 says. No import of another module.

**D2. Logic lives in TS `domain/`, pure (no fs, fetch, React, pg).** SQL is reduced to two dumb
fetches. Files:
- `domain/placeholders.ts`: the single placeholder set `{'S/N','SN','0','','N/A'}` (case-insensitive,
  trimmed, NULL included) maps to `"NONE"`. Two normalizers, as in SQL: `normalizeCode` (street_number,
  letter, square, sandlot: placeholder set) and `normalizeText` (NULL/blank only maps to `"NONE"`).
- `domain/matchKey.ts`: `buildMatchKey(row)` is **byte-for-byte the v3 `keyed` CTE** (SQL lines
  ~82-115): `NOKEY:<urn>` when padron blank AND street name blank; else `|`-joined, upper+trimmed:
  province, province_code, locality_code, locality, postal_code, padron-locality-or-geo-bucket,
  street_name, street_number, letter, square, sandlot, km, padron, type_padron, rs_reftramo. The
  geo bucket is `GEO:` + lat/lng rounded to **2** decimals when padron present, **3** when absent,
  used only when `padron_locality` is null (SQL `coalesce` keeps an empty-string
  `padron_locality`; replicate that exactly, do not "improve" it). Rounding must match Postgres
  `round(numeric,n)` (half away from zero); do not use `toFixed` blindly, write a helper and test
  the boundary. `km` renders via its text form.
- `domain/decision.ts`: `decideGroup(members)` returns a decision per member, implementing the v3
  `decided` CTE exactly:
  `fuente==='IDE'` -> KEEP; matched (either infra flag) -> KEEP; group size 1 -> KEEP;
  `fuente in {ANTEL,TLK}` && `nMatchedInGroup===0` && `poolRankInGroup===1` -> KEEP; else REMOVE.
  `nMatchedInGroup` counts ANTEL/TLK members with a match. `poolRankInGroup` = rank among
  **ANTEL/TLK members only** (IDE excluded), ordered by numeric urn suffix (`id:(\d+)$`) ascending,
  NULLS LAST. `dup_group_size` counts ALL members including IDE. Tie-break for equal/missing urn
  numbers must be deterministic (fall back to urn string compare). **There is no FLAGGED state in
  v3. Do not implement it.**
- `domain/groups.ts`: group rows by key, attach `dupGroupSize`, `nMatchedInGroup`,
  `poolRankInGroup`, `decision`; keep only groups with at least one REMOVE (v3 `remove_groups`); assign
  `groupId` (1-based, deterministic: sort keys with plain code-unit comparison; numbering is not
  required to equal Postgres' collation order, group ids were already documented as unstable);
  order members within a group: non-REMOVE first, then fuente, then urn (matches v3 ORDER BY
  `(decision='REMOVE'), fuente, urn`).
- `domain/summary.ts`: counts per decision x fuente (the "Headline numbers" table shape) and group
  count.
- `domain/export.ts`: rows to CSV string (RFC-4180 quoting, `\r\n`, UTF-8, header from a const
  column list); rows to GeoJSON `FeatureCollection` of Points `[lng, lat]` with all row fields in
  `properties` (skip rows with null/NaN coords, count how many were skipped and return that);
  groups to GeoJSON LineStrings joining each group's members (QGIS clustering note in TRACKER
  "Method"), properties `{groupId, size}`; skip groups with fewer than 2 locatable members.
- `types.ts`: `AddressRow`, `Fuente` (`const` object, not raw strings), `Decision`, `DecidedRow`,
  `DedupGroup`, `DedupSummary`, `DedupScope`, `DedupRules`, `ExportFormat`.
- `constants.ts`: source/table/column names, placeholder set, decimals, row cap, statement
  timeout, HTTP statuses, query param names. No raw string literals compared inline.

**D3. Rules are data.** `DedupRules` const default in `constants.ts`: `detectionFonts` (the
`id_font` list `[1, 9, 10]`), `removableFuentes` (`['ANTEL','TLK']`), `protectedFuentes` (`['IDE']`),
`geoDecimalsWithPadron: 2`, `geoDecimalsWithoutPadron: 3`. `fuente` is derived from
`v_address_build.name_font` exactly as in the SQL (values `ANTEL`, `IDE`, `TLK`). The scope
(`id_province`, default **7 = FLORES**) is a **request parameter**, not a constant. `document_type`
is fixed to `'PARENT'`. The two SQL files disagree in a comment about the `id_font` mapping; the
code in `find_removal_candidates.sql` (`IN (1, 9, 10)` with `name_font` as `fuente`) is the truth.
Do not guess, and flag the discrepancy in TO_ORCHESTRATOR.md.

**D4. Database access = reuse, do not reinvent.** The project already has:
`DbConfig` / `SafeDbConfig` (`src/core/types/db.ts`), `INITIAL_DB_CONFIG`
(`src/core/constants/dbConfigDefaults.ts`), profile storage without passwords
(`src/core/services/localStorageDbConfig.ts`), and server-side `pg` `Client` usage with connection
params + password supplied per request (`src/app/api/db/test/route.ts`,
`src/app/api/db/execute/route.ts`). Follow that exact model:
- Credentials arrive in the POST body (`host, port, db_name, user, password`); the password is never
  stored server-side or in localStorage, never logged, never echoed back in a response or error.
  Same defaults as the existing routes (`host||"localhost"`, `Number(port)||5432`).
- `services/AddressRepository.ts` defines an **interface** (`loadAddressRows`, `loadInfraMatchedUrns`)
  so everything above it is testable with a fake.
- `services/PgAddressRepository.ts` is the real implementation using `pg` (`Client`, one
  connection per analysis, `connectionTimeoutMillis: 10000`). It MUST run inside
  `BEGIN READ ONLY` and set `SET LOCAL statement_timeout` (const, 120000 ms) and always `ROLLBACK`
  + `client.end()` in `finally`. A write attempt must fail at the database, not rely on our code.
- `loadAddressRows`: single parameterized query on `carto.v_address_build` with exactly the columns
  the v3 `src` CTE selects, `WHERE id_font = ANY($1) AND id_province = $2 AND document_type =
  'PARENT'`. All values bound as parameters; no string-built SQL from request data. Enforce
  `MAX_SOURCE_ROWS` (const, 500000): if exceeded, fail with a Spanish error asking to narrow scope.
  Never silently truncate.
- `loadInfraMatchedUrns(urns)`: do **not** scan the 1.27M-row `match_tlk.direcciones_tlk_serv_cto_cgeo`.
  Query both tables with `WHERE urn = ANY($1)` (`integrador.nap_physical_device` joins on
  `urn_site_location`), in chunks of 10000 urns, returning two `Set<string>` (one per table, so the
  UI can show which table justified a KEEP). Only ANTEL/TLK urns need checking.
- Do **not** reuse `/api/db/execute` or any route under `src/app/api/db/`: they are not read-only.
  Do **not** add `pg` helpers to `core/`; keep the adapter inside the module.
- `services/DedupOrchestrator.ts` (constructor-injected repository, like `WatcherOrchestrator`):
  load rows, key, group, fetch infra flags for ANTEL/TLK members of groups with size>1,
  decide, summary. Pure orchestration; unit-tested with a fake repository.

**D5. HTTP surface** (`module.routes.json`, all `nodejs` + `force-dynamic`):
- `POST analyze`: body `{ connection:{host,port,db_name,user,password}, provinceId:number }` returns
  `{ success:true, summary, groups, skippedWithoutCoordinates }`. Groups carry all decided rows.
  Validate: `db_name`, `user`, `password` required, `provinceId` a positive integer (400 with
  Spanish messages, mirroring the existing routes).
- `POST export`: same body plus `format: "csv" | "geojson" | "links"` returns a file response with
  `Content-Disposition: attachment` and the right content type. (POST because it carries
  credentials; **never** accept credentials in a query string.) Re-runs the analysis (stateless;
  no server-side cache, no session store, deliberately).
Handlers in `api/handlers.ts` speak Web `Request`/`Response` only, thin, orchestrator injected via
`createDedupHandlers(orchestrator = new DedupOrchestrator(new PgAddressRepository()))`. No
`next/*` import anywhere in the module.

**D6. UI** (Spanish text, Lucide only, `.module.css`, no inline styles, atomic components, no
single-letter identifiers). Module owns a page at `/tools/m/address-dedup` wrapped in
`ToolWorkspaceLayout` (see how `src/app/tools/db-db-sync/page.tsx` uses it), plus a
`HOME_TOOL_GRID` card like `WatcherHomeCard`. Components, each small: `DedupDashboard`
(orchestrates), `DedupConnectionForm` (host/port/db/user/password + province id; **reuse**
`FormField`, `Button`, `AlertMessage`, `ProfileSelect`, `loadDbProfilesFromLocalStorage` /
`saveDbProfileToLocalStorage`, `INITIAL_DB_CONFIG`; do NOT reuse `DbConnectionForm`, it requires a
table and fetches columns), `DedupSummaryTable`, `DedupGroupList` (paginated with the existing
`PaginationControls`, group members with decision badge using `Badge`), `DedupExportBar` (three
download buttons), `dedupClient.ts` (fetch wrapper). Every component the manifest references must
come from a `"use client"` module (module_authoring Step 4) including icons, via
`ui/contributionIcons.ts`. Use `@tanstack/react-query` mutation like the other tools if that is
the local convention; otherwise plain state. **No map in this mission** (see out of scope).

**D7. Safety of the response.** Error messages from `pg` may include the host; they must never
include the password. Add a test that a failing connection's error body does not contain the
submitted password.

**D8. Docs.** Add `docs/tools/ADDRESS_DEDUP_MODULE.md` (purpose, rules table with the v3 decision
table, endpoints, how to extend rules, what is explicitly not done) and link it in
`docs/README.md`. A one-line pointer in `CLAUDE.md`'s tools list is allowed. Do NOT copy
production address data or CSV rows into the repo or tests.

**D9. Allowed edits outside the module:** `src/app/modules.registry.ts` (one import + one array
entry), generated `src/app/api/m/address-dedup/**` via `npm run modules:routes`, `docs/**`,
`CLAUDE.md` pointer. Nothing else. If you believe something else must change, stop and ask.

## Out of scope (do not implement; reasons)
- **Deletes / any write path**: user decision. Investigation first, deletes later behind a separate
  confirmed step.
- **FLAGGED group state**: v2-only, superseded by v3.
- **Map visualisation**: GeoJSON export for QGIS covers it; the map stack (viewport windowing,
  hidden-container fit) is a separate, recently-fixed area; adding it doubles the review surface.
- **Server-side caching / job queue / persisted results**: stateless on purpose.
- **Configuring rules in the UI**: rules are a typed const + request `provinceId`; UI exposure
  later.
- **Streaming / workers for huge scopes**: the row cap + clear error is the guard for now.
- **Changing the five existing tools, core types, or `/api/db/*` routes.**
- **ANC source**: not present in `carto.address`.
- **Running anything against production.** You have no mandate to connect to a real database. Tests
  use fakes only.

## Required tests (`tests/unit/modules/address-dedup/`, Vitest, AAA, real computations; mock only repository / pg I/O)
`placeholders.test.ts`
- each placeholder (`NULL`, `''`, `'  '`, `'N/A'`, `'n/a'`, `'S/N'`, `'sn'`, `'0'`) maps to `NONE`; real
  values trimmed/uppercased and kept; `normalizeText` does NOT treat `'0'`/`'N/A'` as empty.

`matchKey.test.ts`
- identical rows give identical key; each of the 15 key fields changing alone gives a different key.
- Regression: `cgeo:Antel:address:id:4006567` vs `4006568` (Flores, padron 4053, RURAL, number `'0'`,
  no street, same coords): **same key**.
- Regression: `TLK:4015195` (puerta 272) vs `TLK:4015197` (puerta 266), same padron: **different keys**.
- Regression (correction #9): ANTEL `4004103` (389, letra BIS, square 0) vs IDE `684702` (389, letra
  N/A, square 100): **different keys**; `4005609` vs `4756661` ("JOSE PEDRO VARELA" 154, letra
  N/A/N/A, square 0/0): **same key**.
- Regression (correction #7): 96 rows sharing a street, `puerta='0'`, each with a distinct padron
  and coords: 96 distinct keys.
- Correction #5: same padron/RURAL, `padron_locality` null, coords 50 km apart: different keys;
  ~13 m apart (same 2-decimal bucket): same key; `padron_locality` present beats the bucket.
- No padron + no street gives `NOKEY:<urn>`; two such rows never collide.
- Rounding boundary: `round` half-away-from-zero for positive and negative coordinates at the
  2- and 3-decimal buckets.
- `km` null vs `0` differ.

`decision.test.ts` (one test per branch of the v3 CASE, plus)
- IDE always KEEP even when unmatched in a group of 5.
- Matched ANTEL KEEP; its unmatched ANTEL and TLK siblings REMOVE.
- Singleton unmatched ANTEL KEEP.
- Group of two unmatched ANTEL: lowest urn number KEEP, other REMOVE; numeric (not lexicographic)
  ordering (`...:id:999` vs `...:id:1000`).
- Group ANTEL + TLK, none matched: lowest urn across both KEEP.
- Group IDE + one unmatched ANTEL: ANTEL is KEEP (faithful v3 behaviour; pin it with a test whose
  name states it, see the orchestrator's risk note).
- Two matched members: both KEEP, a third unmatched REMOVE.
- Matched via either infra table independently (two flags).
- Urn without numeric suffix sorts last; deterministic tie-break.

`groups.test.ts`
- groups with no REMOVE are dropped; `dupGroupSize` counts IDE; ordering within group; `groupId`
  deterministic across input permutations (shuffle input, same output).
- Empty input gives empty output; no crash.

`summary.test.ts`: counts by decision x fuente match a hand-computed fixture; zero-row table.

`export.test.ts`
- CSV: quoting of commas, quotes, newlines, leading/trailing spaces; `\r\n`; header order; empty
  rows give header only.
- GeoJSON points: `[lng, lat]` order; null/NaN coords skipped and counted.
- Links: one LineString per group with 2+ locatable members; groups with fewer skipped.

`dedupOrchestration.test.ts` (fake repository)
- end-to-end happy path equals a hand-computed result; infra urns requested **only** for ANTEL/TLK
  members of groups with size>1 (assert the fake's received args); chunking at the 10000 boundary
  (10000, 10001 urns); row cap exceeded gives a Spanish error, nothing truncated; repository failure
  propagates.

`pgAddressRepository.test.ts` (fake `pg` client, the I/O boundary)
- issues `BEGIN READ ONLY` first, `ROLLBACK` last, `end()` called on success AND on error; all
  request values passed as bound parameters (assert text has no interpolated user value); statement
  timeout set; a write statement is never issued.

`handlers.test.ts`
- 400 for missing `db_name`/`user`/`password`/bad `provinceId` (Spanish messages); malformed JSON
  gives 400 not 500; success shape; export content types + `Content-Disposition`; error body never
  contains the submitted password (D7); credentials in a query string are ignored (request still 400).

`addressDedupManifest.test.ts`: mirror `cartographyWatcherManifest.test.ts`: endpoints bound to
the intended handlers, `runtime`/`dynamic` survive, page bound at `""`, contribution targets
`HOME_TOOL_GRID` (a mounted slot).

## Definition of done: the full gauntlet, real output pasted into your report
Run in this order from the repo root with the portable Node on PATH:
```
npm run modules:routes          # generate, then:
npm run modules:routes:check
npm run lint                    # 0 errors, 0 warnings
npm test                        # all suites green; report suite/test counts
npm run build                   # clean Turbopack build
npm run doctor                  # zero findings ("Score unavailable" is expected, not a failure)
```
Plus the **deletability proof** (module_authoring section 6): temporarily remove the registry line, run
`npm run modules:routes`, confirm the generated `address-dedup` routes disappear and the app still
builds, then restore. Paste what you ran. No gate may be weakened, no assertion relaxed, no
`eslint-disable` / `@ts-ignore` added to pass. Before reporting, audit for dead code, unused
exports and unused imports (coding guideline 14).

## Reporting
Append your report under a new heading in `.agents/handoff/TO_ORCHESTRATOR.md`: files created,
gauntlet output verbatim, anything skipped or partial **stated plainly**, and every question you
hit. Do not claim a gate passed that you did not run.

Do not commit.


---

# Mission (REVISED, supersedes the earlier "address-dedup module" section above) — SQL as the engine

**This section replaces the previous `address-dedup` brief entirely.** If the two disagree, this one
wins. The earlier brief's D2 (TS key/decision port), D3, the `GroupAccumulator`/streaming
discussion and its test list are void. Everything not restated here and not contradicted (module
shape, D1, read-only, D4's safety rules, D7, D8, D9, out-of-scope list, gauntlet) still applies, and
is restated below so this section stands alone.

**Branch:** `feat/module-address-dedup`, cut from `main`. **Do not commit. Do not push.**
**Node:** `npm` is not on PATH. Prepend `C:\Alekos\Tools\node24portable` to `$env:PATH`, or call
`C:\Alekos\Tools\node24portable\npm.cmd` directly (`.agents/rules/portable_node.md`).
**Binding rules (read in full):** `AGENTS.md`, `CLAUDE.md`, `.agents/rules/module_authoring.md`,
`coding_guidelines.md`, `testing_standards.md`, `testing_branch_workflow.md`,
`code_review_standards.md`. Reference module: `src/modules/cartography-watcher/`.

## Background
Ticket CGEO-2192 was a read-only investigation against production Postgres: find duplicate
addresses in `carto.v_address_build`, decide KEEP/REMOVE per row, export CSV/GeoJSON for QGIS.
We are making it a reusable, deletable module. **Postgres does the work**: the validated v3 SQL
is the engine and the module runs it read-only and presents the result. Source of truth:
- `C:\Alekos\Tasks\CGEO-2192\prod\v3\find_removal_candidates.sql` (the query to port)
- `C:\Alekos\Tasks\CGEO-2192\TRACKER.md` (why each rule exists; read corrections #4, #5, #7, #9, #10, #11)

**Scope: INVESTIGATION ONLY.** No endpoint, service or UI path may write to any database.

## Decisions (binding)

**D1. Module** `src/modules/address-dedup/`, `moduleId` `address-dedup`. Deletion set: that folder,
its line in `src/app/modules.registry.ts`, `tests/unit/modules/address-dedup/`, and the generated
`src/app/api/m/address-dedup/**` (regenerated, never hand-edited). No import of another module. No
edits to `core/` or `ui-kit/` except what D10 allows.

**D2. One query, one file.** `services/queries/duplicateAnalysisQuery.ts` exports the SQL text as a
single constant (a TS template, not a `.sql` import, so bundling stays trivial) plus the ordered
parameter list. It is a port of `find_removal_candidates.sql` with the changes in D3. The
match-key expression is written **once** (the `keyed` CTE) and never duplicated. Keep every
existing comment that explains a rule's *why* (they are the tracker's institutional memory), but
fix the comments the code contradicts (see D3, "Known comment/code mismatch"). All values are
**bound parameters**; no SQL is assembled from request data.

Parameters (cast explicitly in the SQL, e.g. `$5::int`):
1. `$1 int[]` detection fonts (default `[1, 9, 10]`)
2. `$2 int` province id (request parameter; UI default 7 = FLORES)
3. `$3 text[]` removable fuentes (default `{ANTEL,TLK}`)
4. `$4 text[]` protected fuentes (default `{IDE}`)
5. `$5 int` geo decimals when padron present (default 2)
6. `$6 int` geo decimals when padron absent (default 3)
7. `$7 boolean` `protectedSiblingRemovesLone` (default **false**, see D3)
8. `$8 text` output scope: `REMOVAL_GROUPS` (default) | `ALL_DUPLICATE_GROUPS`
`document_type = 'PARENT'` stays a literal. Defaults live in `constants.ts` as one `DedupRules`
const object; `fuente` comes from `v_address_build.name_font` exactly as in the SQL (values
`ANTEL`, `IDE`, `TLK`). The two v3 SQL files disagree in a comment about the `id_font` mapping
(`find_removal_candidates.sql` code is the truth: `IN (1, 9, 10)`, `name_font` as `fuente`). Do not
guess; flag the discrepancy in TO_ORCHESTRATOR.md.

**D3. Two behavioural additions to the v3 query (user-driven), everything else byte-faithful.**

*Why:* v3 only outputs groups that contain at least one REMOVE. An unmatched ANTEL/TLK that is the
lowest-urn ANTEL/TLK member of a group, but whose group also holds an IDE row, is KEEP (rank 1 is
computed among ANTEL/TLK only), so its group is never exported and the user cannot see it in QGIS.
The user wants to inspect those cases visually to decide whether that is a rule worth keeping.

(a) **`decision_reason` column** on every output row, one of these const values (define them in
`constants.ts` as a const object, mirrored in SQL as literals):

| decision | reason | meaning |
|---|---|---|
| KEEP | `PROTECTED_SOURCE` | `fuente` in protected fuentes |
| KEEP | `INFRA_MATCHED` | matched in either infra table |
| KEEP | `NO_DUPLICATE` | group size 1 |
| KEEP | `LOWEST_URN_KEPT` | no member matched; lowest-urn ANTEL/TLK, and the group has **no** protected member |
| KEEP | `KEPT_ALONGSIDE_PROTECTED` | same branch as above but the group **does** contain a protected-source member. This is the case to review. |
| REMOVE | `REDUNDANT_WITH_MATCHED` | another ANTEL/TLK member matched (`n_matched_in_group > 0`) |
| REMOVE | `REDUNDANT_NOT_LOWEST_URN` | nothing matched, rank > 1 |
| REMOVE | `REDUNDANT_WITH_PROTECTED` | only when `$7 = true`: unmatched ANTEL/TLK in a group that has a protected member |

(b) **`$7` rule toggle.** When `true`, an unmatched removable-source member of a group that
contains a protected-source member is REMOVE (`REDUNDANT_WITH_PROTECTED`). This branch sits
**after** the `matched` and `dup_group_size = 1` KEEP branches and **before** the
rank branch. When `false` (default) the decision is exactly v3. Needs a window flag
`has_protected_in_group` (`bool_or(fuente = ANY($4)) OVER (PARTITION BY match_key)`).

(c) **Output scope `$8`.** `REMOVAL_GROUPS` = v3 behaviour (groups with at least one REMOVE).
`ALL_DUPLICATE_GROUPS` = every group with `dup_group_size > 1`, which includes the
`KEPT_ALONGSIDE_PROTECTED` groups and the groups that are all-KEEP. Same column set either way.

*Known comment/code mismatch (fix the comment, not the behaviour):* the v3 header says the
lowest-urn member "across the WHOLE group (any source)" is KEEP when nothing matched. The code
ranks ANTEL/TLK members only. The code produced the delivered numbers; keep it and make the
comment truthful.

**D4. Database access: reuse, do not reinvent.** Reuse the project model: `DbConfig` /
`SafeDbConfig` (`src/core/types/db.ts`), `INITIAL_DB_CONFIG`
(`src/core/constants/dbConfigDefaults.ts`), profile storage without passwords
(`src/core/services/localStorageDbConfig.ts`), and server-side `pg` `Client` with params +
password per request (see `src/app/api/db/test/route.ts`).
- Credentials arrive in the POST body (`host, port, db_name, user, password`). The password is
  never stored, logged, or echoed in any response or error. Same defaults as the existing routes
  (`host||"localhost"`, `Number(port)||5432`).
- `services/AddressRepository.ts`: **interface** `runDuplicateAnalysis(params): Promise<AnalysisRow[]>`.
- `services/PgAddressRepository.ts`: real implementation with `pg` `Client`, one connection per
  call, `connectionTimeoutMillis: 10000`. Runs in `BEGIN READ ONLY`, `SET LOCAL statement_timeout`
  (const, 180000 ms, the query is heavy and runs on prod), always `ROLLBACK` + `client.end()` in
  `finally`. A write attempt must fail at the database itself.
- Do **not** reuse `/api/db/execute` or anything under `src/app/api/db/`: not read-only. Do **not**
  put `pg` helpers in `core/`.
- `services/DedupOrchestrator.ts`: constructor-injected repository; maps request to parameters,
  runs the query, returns `{ rows, summary }`. Thin.
- **No streaming, no cursor, no row cap, no snapshot file**: the query returns only the decided
  groups (2,581 rows for Flores). Do not add them.

**D5. HTTP surface** (`module.routes.json`, all `nodejs` + `force-dynamic`):
- `POST analyze`: body `{ connection:{host,port,db_name,user,password}, provinceId:number,
  protectedSiblingRemovesLone?:boolean, scope?:"REMOVAL_GROUPS"|"ALL_DUPLICATE_GROUPS" }` returns
  `{ success:true, summary, groups, skippedWithoutCoordinates }`. Validate `db_name`, `user`,
  `password` required; `provinceId` positive integer; unknown `scope` rejected (400, Spanish
  messages mirroring the existing routes).
- `POST export`: same body plus `format: "csv" | "geojson" | "links"` returns an attachment with
  the right content type and `Content-Disposition`. POST because it carries credentials; **never**
  accept credentials in a query string. Stateless, re-runs the query, no cache or session store.
Handlers speak Web `Request`/`Response` only, thin, orchestrator injected via
`createDedupHandlers(orchestrator = new DedupOrchestrator(new PgAddressRepository()))`.
No `next/*` in the module.

**D6. TS domain is now small and pure** (`domain/`): 
- `summary.ts`: counts by decision x fuente (the "Headline numbers" table) **and by
  `decision_reason`** (the user needs to see how many `KEPT_ALONGSIDE_PROTECTED` rows exist), plus
  group count.
- `groups.ts`: group the flat rows by `group_id`, preserving the SQL order.
- `export.ts`: rows to CSV (RFC-4180 quoting, `\r\n`, UTF-8, header from a const column list that
  **includes `decision` and `decision_reason`**); rows to GeoJSON Points `[lng, lat]` with all fields
  in `properties` (`decision_reason` included so QGIS can style by it; skip null/NaN coords, count
  them); groups to GeoJSON LineStrings joining members, properties `{groupId, size}`, skipping
  groups with fewer than 2 locatable members.
- `types.ts`, `constants.ts` as before. `Fuente`, `Decision`, `DecisionReason` are const objects,
  never raw string compares.

**D7. Response safety.** `pg` errors can include the host; they must never include the password.
Test it.

**D8. Docs.** `docs/tools/ADDRESS_DEDUP_MODULE.md` (purpose, the v3 decision table with the D3
reasons, the `$7` toggle, scope, endpoints, how to change a rule, what is not done) linked from
`docs/README.md`; one-line pointer in `CLAUDE.md` allowed. No production data in the repo.

**D9. UI** (Spanish, Lucide only, `.module.css`, no inline styles, atomic components, no
single-letter identifiers, every manifest-referenced component from a `"use client"` module including
icons via `ui/contributionIcons.ts`). Page at `/tools/m/address-dedup` inside `ToolWorkspaceLayout`
(see `src/app/tools/db-db-sync/page.tsx`) plus a `HOME_TOOL_GRID` card like `WatcherHomeCard`.
Components: `DedupDashboard`, `DedupConnectionForm` (host/port/db/user/password + province id;
**reuse** `FormField`, `Button`, `AlertMessage`, `ProfileSelect`, `loadDbProfilesFromLocalStorage` /
`saveDbProfileToLocalStorage`, `INITIAL_DB_CONFIG`; do **not** reuse `DbConnectionForm`, it requires
a table), `DedupOptionsPanel` (checkbox "Eliminar ANTEL/TLK duplicado de una fuente protegida (IDE)",
default off; checkbox "Incluir grupos sin eliminaciones (para revisión)", default off),
`DedupSummaryTable` (by decision x fuente and by reason), `DedupGroupList` (paginated with
`PaginationControls`, `Badge` per decision/reason), `DedupExportBar` (3 download buttons),
`dedupClient.ts`. Use a `@tanstack/react-query` mutation if that is the local convention. No map.

**D10. Allowed edits outside the module:** `src/app/modules.registry.ts` (one import + one entry),
generated `src/app/api/m/address-dedup/**`, `docs/**`, the `CLAUDE.md` pointer, and
`package.json` / lockfile for **one new devDependency: `@electric-sql/pglite`** (D11). Nothing else;
if you think something else must change, stop and ask.

**D11. SQL is tested with a real Postgres engine: `@electric-sql/pglite` (devDependency only,
never imported by production code).** Install with the portable `npm`. Tests create in-process
`carto.v_address_build`, `match_tlk.direcciones_tlk_serv_cto_cgeo` (column `urn`) and
`integrador.nap_physical_device` (column `urn_site_location`) with only the columns the query uses,
insert **synthetic** rows, and run the **exact exported query text** with bound parameters (the
same code path the repository uses; share a small function that runs it against any
`{ query(text, values) }` so the pglite test and the `pg` repository execute identical SQL). If a
construct in the query is unsupported by pglite, **do not edit the query to suit pglite**: stop and
report it in TO_ORCHESTRATOR.md. If installing the dependency fails (registry/TLS), stop and report.

## Out of scope (do not implement)
- Deletes or any write path (user: investigation first, deletes later behind a confirmed step).
- The infrastructure-matches stacked view (`find_infrastructure_matches.sql`): deferred to a later
  mission; do not port it.
- FLAGGED group state (v2 only, superseded).
- Map view (GeoJSON export covers QGIS).
- Streaming, cursors, row caps, snapshot files, caching, job queues, persisted results.
- A TS re-implementation of the key or the decision (the point of this revision).
- UI to edit fuente lists / decimals / font ids (typed const only).
- Changes to the five existing tools, core types, `/api/db/*` routes.
- ANC source. Connecting to a real database: tests use pglite and fakes only; you have no mandate
  to touch production.

## Required tests (`tests/unit/modules/address-dedup/`, Vitest, AAA, real computations; mock only the I/O boundary)

`duplicateAnalysisQuery.test.ts` (pglite, synthetic rows, assertions on `group_id` membership,
`decision`, `decision_reason`)
- Regression: ANTEL `cgeo:Antel:address:id:4006567` and `4006568` (Flores, padron 4053, RURAL,
  number `'0'`, no street, same coords) land in the **same group**.
- Regression: TLK `4015195` (puerta 272) vs `4015197` (puerta 266), same padron: **different
  groups**.
- Regression (correction #9): ANTEL `4004103` (389, letra BIS, square 0) vs IDE `684702` (389, letra
  N/A, square 100): different groups; `4005609` vs `4756661` (letra N/A/N/A, square 0/0): same group.
- Regression (correction #7): 96 rows, same street, `puerta='0'`, each with a distinct padron and
  coords: no group formed.
- Correction #5: same padron/RURAL, null `padron_locality`, coords ~50 km apart: different groups;
  ~13 m apart (same 2-decimal bucket): same group; present `padron_locality` beats the bucket.
- No padron and no street: never grouped (`NOKEY` behaviour).
- Placeholder equivalence: `NULL`, `''`, `'N/A'`, `'S/N'`, `'SN'`, `'0'` treated as the same "none"
  for number/letter/square/sandlot; a real letra differentiates.
- Every branch of the decision with its reason: IDE KEEP/`PROTECTED_SOURCE` even in a group of 5;
  matched KEEP/`INFRA_MATCHED` (via `direcciones_tlk_serv_cto_cgeo` and via `nap_physical_device`,
  separately); singleton KEEP/`NO_DUPLICATE`; matched member plus unmatched ANTEL and TLK siblings:
  siblings REMOVE/`REDUNDANT_WITH_MATCHED`; two unmatched ANTEL: lowest urn number KEEP/
  `LOWEST_URN_KEPT`, other REMOVE/`REDUNDANT_NOT_LOWEST_URN`, with numeric ordering
  (`id:999` vs `id:1000`); ANTEL + TLK none matched: lowest across both; two matched members both
  KEEP.
- **The IDE case:** group IDE + one unmatched ANTEL, `$7=false`, scope `ALL_DUPLICATE_GROUPS`:
  ANTEL is KEEP/`KEPT_ALONGSIDE_PROTECTED` and the group appears. Same fixture with scope
  `REMOVAL_GROUPS`: group **absent** (the v3 gap, pinned by a test whose name says so). Same fixture
  with `$7=true`: ANTEL REMOVE/`REDUNDANT_WITH_PROTECTED` and the group appears under both scopes.
  With `$7=true`, a **matched** ANTEL beside an IDE row stays KEEP/`INFRA_MATCHED`.
- Scope: `ALL_DUPLICATE_GROUPS` includes all-KEEP groups that `REMOVAL_GROUPS` omits; singletons never
  appear in either.
- Parameter binding: province filter, font filter and `document_type='PARENT'` each exclude the
  expected rows.
- Output order: within a group non-REMOVE first, then `fuente`, then `urn`.

`summary.test.ts`: decision x fuente and by-reason counts against a hand-computed fixture; empty.
`groups.test.ts`: grouping by `group_id` preserves order; empty input.
`export.test.ts`: CSV quoting (commas, quotes, newlines, edge spaces), `\r\n`, header includes
`decision_reason`, empty gives header only; GeoJSON Points `[lng, lat]` order, `decision_reason` in
properties, null/NaN skipped and counted; Links: one LineString per group with 2+ locatable
members, fewer skipped.
`dedupOrchestration.test.ts` (fake repository): request maps to the 8 parameters in order (assert
the fake's received args, including defaults); summary matches; repository failure propagates.
`pgAddressRepository.test.ts` (fake `pg` client): `BEGIN READ ONLY` first, `ROLLBACK` last,
`end()` on success and on error, statement timeout set, values bound (no interpolated user value in
the text), no write statement ever issued.
`handlers.test.ts`: 400 for missing `db_name`/`user`/`password`, bad `provinceId`, unknown `scope`
(Spanish messages); malformed JSON gives 400 not 500; success shape; export content types +
`Content-Disposition`; error body never contains the submitted password; credentials in a query
string are ignored.
`addressDedupManifest.test.ts`: mirror `cartographyWatcherManifest.test.ts` (endpoints bound,
`runtime`/`dynamic` survive, page at `""`, contribution targets mounted slot `HOME_TOOL_GRID`).

## Definition of done: full gauntlet, real output pasted
Order, from the repo root with portable Node on PATH:
```
npm run modules:routes && npm run modules:routes:check
npm run lint          # 0 errors, 0 warnings
npm test              # all suites green; report suite/test counts
npm run build         # clean Turbopack build
npm run doctor        # zero findings ("Score unavailable" is expected)
```
Plus the **deletability proof** (module_authoring section 6): remove the registry line, run
`npm run modules:routes`, confirm the `address-dedup` generated routes disappear and the app still
builds, restore. Paste what you ran. No gate weakened, no assertion relaxed, no `eslint-disable` /
`@ts-ignore`. Audit dead code, unused exports and imports before reporting (guideline 14).

## Reporting
Append a report under a new heading in `.agents/handoff/TO_ORCHESTRATOR.md`: files created,
gauntlet output verbatim, anything skipped or partial **stated plainly**, every question hit, and
whether pglite ran the query unmodified. Do not claim a gate passed that you did not run.

Do not commit.


---

# Mission — `address-dedup` UI redesign (layout + table UX)

**Branch:** stay on `feat/module-address-dedup` (uncommitted work from the previous rounds is the base). **Do not commit. Do not push.**
**Node:** `npm` is not on PATH. Prepend `C:\Alekos\Tools\node24portable` to `$env:PATH`, or call `C:\Alekos\Tools\node24portable\npm.cmd`.
**Binding rules (re-read):** `AGENTS.md`, `CLAUDE.md`, `.agents/rules/module_authoring.md`, `coding_guidelines.md` (Spanish UI, Lucide only, **zero inline styles**, `.module.css`, atomic components, no single-letter identifiers, const objects not raw string compares, no static data inside `.tsx`), `testing_standards.md`.

## Why
The user ran the module on real data and found the page poor: connection form, options, summary,
export and the group list are stacked on one page, and the tables are plain (see current
`ui/DedupSummaryTable.tsx`, `ui/DedupGroupList.tsx`, `ui/DedupDashboard.tsx`). They want a clearer
layout and better table UX. Real result size for Flores: ~1,200 groups / ~3,300 rows, so a client-side
table is fine; no virtualisation, no new dependency.

## Scope
**UI only.** Do NOT touch: the SQL, `services/**`, `api/**`, `module.routes.json`, `manifest.ts`,
`domain/summary.ts|groups.ts|export.ts` behaviour, `core/`, `ui-kit/` components' behaviour, or any
other tool. Adding new files in the module and editing the module's own `ui/`, `data/`, `constants.ts`
is allowed. You may **read** ui-kit components and reuse them (`PaginationControls`, `Badge`,
`Button`, `FormField`, `AlertMessage`, `ProgressBar`, existing CSS tokens from `src/app/globals.css`
such as `--accent-*`, `--text-*`, `--border-color`, `--font-mono`). Match the look of the existing
tools (dark glass panels); do not invent a new visual language.

## Binding design decisions (do not revisit; raise questions in TO_ORCHESTRATOR.md)

**U1. Two page states instead of one long stack.**
- *Before a result:* one centred "Configuración" card (connection fields, province, the two option
  checkboxes, the Run button). Nothing else on the page.
- *After a result:* the form collapses into a compact **context bar** showing
  `db_name@host · Provincia N` plus chips for the active options (e.g. "Elimina duplicados de IDE",
  "Incluye grupos sin eliminaciones"), and the buttons **Editar parámetros** (re-expands the full
  card above the results, with a Cancel/collapse control), **Volver a ejecutar**, and the export
  group. Password is never shown in the bar.
- Results live under the bar in **two tabs: "Resumen" and "Grupos (N)"** (N = group count, formatted).
  Default tab after a run: Resumen. Tab state resets to Resumen on a new result. Implement tabs as an
  accessible tablist (`role="tablist"`, `role="tab"`, `aria-selected`, `role="tabpanel"`, arrow-key
  navigation). Check whether `ui-kit` already has a tabs primitive before writing one
  (`ModuleTabbedSlot` exists: read it; reuse only if it genuinely fits, otherwise write a small module-local
  `DedupTabs`).
- While running: replace the results area with a loading card: indeterminate `ProgressBar` (or the
  closest existing one) and the text that the query runs on PostgreSQL and **can take up to 3
  minutes**. Disable the Run button. No timers/intervals/effects for an elapsed clock.
- Errors: `AlertMessage` inside the card that caused them (config card for validation/connection
  errors; results area for export errors). Keep the "rows without coordinates" warning, placed on the
  Grupos/export area, not in the summary.

**U2. Resumen tab.**
1. A row of **KPI cards** (5): Grupos, Filas, A eliminar (red accent), A conservar (green accent),
   Para revisar (amber accent; = rows with reason `KEPT_ALONGSIDE_PROTECTED`; includes a short hint
   "Conservadas junto a una fuente protegida"; when 0 show the card dimmed with "Ninguna"). Values use
   `formatNumber`; large number, small label, `font-variant-numeric: tabular-nums`.
2. **"Decisión por fuente"** matrix: rows Eliminar/Conservar plus a **Total row**, columns ANTEL, TLK,
   IDE, "Otras / sin fuente" plus a **Total column**. Numbers right-aligned, tabular-nums; zero cells
   dimmed (muted colour, rendered as "0", not hidden); totals bold; decision cell has a coloured dot or
   Lucide icon, not just text.
3. **"Motivos"** as **two grouped sections** in one table: a "Eliminar" section header followed by its
   reasons (`REDUNDANT_WITH_MATCHED`, `REDUNDANT_NOT_LOWEST_URN`, `REDUNDANT_WITH_PROTECTED`) and a
   "Conservar" section header followed by its reasons (`PROTECTED_SOURCE`, `INFRA_MATCHED`,
   `NO_DUPLICATE`, `LOWEST_URN_KEPT`, `KEPT_ALONGSIDE_PROTECTED`). Columns: Motivo, Filas, % del total,
   and an **inline proportion bar** (a `<div>` whose width comes from a CSS custom property set via a
   `data-*`-driven class bucket or `<progress>`/`<meter>`; **no inline `style` attribute** — if you
   cannot size a bar without one, use `<meter>`/`<progress>` styled in CSS). Zero-count reasons are
   dimmed. Each reason label gets a one-line explanatory tooltip/`title` (Spanish) taken from a const in
   `data/dedupLabels.ts` (write them from the decision table in
   `docs/tools/ADDRESS_DEDUP_MODULE.md`).
4. Both tables: `<caption>` visually hidden but present, `<th scope>` correct, readable on narrow widths
   (the matrix may scroll horizontally inside its own wrapper; page itself never scrolls sideways).

**U3. Grupos tab = one real table with a toolbar (not a card list).**
- **Toolbar** (sticky within the tab): text search (placeholder "Buscar por URN, padrón o calle";
  matches urn, padron, street_name, street_number, locality, case-insensitive, trimmed);
  **Decisión** select (Todas / Eliminar / Conservar); **Motivo** select (Todos + the 8 reasons);
  **Fuente** select (Todas + the fuentes present in the data); a **"Solo para revisar"** toggle
  (= groups containing a `KEPT_ALONGSIDE_PROTECTED` row); **Orden** select (Grupo ascendente,
  Tamaño descendente, Eliminaciones descendente); a "Limpiar filtros" button shown only when a filter
  is active; and a live count "Mostrando X de Y grupos".
- **Filter semantics (pure, tested):** filtering is at **group** level; a group matches when **at
  least one member** satisfies all active member-level criteria (decision, reason, fuente, search) —
  all active criteria must be satisfied by the same member except the "Solo para revisar" toggle which
  is group-level. A matching group is always displayed **with all its members** (the context is the
  point of the tool). Changing any filter/sort resets to page 1.
- **Table columns:** Fuente · URN (monospace, truncated with full value in `title`, plus a small
  copy-to-clipboard icon button with an accessible label and a brief "copiado" confirmation that does
  not use a timer-effect pattern doctor rejects; if you cannot do it cleanly, drop the confirmation
  and keep the copy button) · Dirección (street + number + letter, "Sin dirección" fallback) · Padrón
  (number + type) · Localidad · Decisión (badge) · Motivo (badge). Coordinates are NOT a column.
- **Group header rows** inside the same `<table>` (one `<tbody>` per group): header shows
  "Grupo N", member count, "X eliminar · Y conservar", an amber "Revisar" badge when the group has a
  `KEPT_ALONGSIDE_PROTECTED` row, and an expand/collapse chevron (Lucide). Groups are **expanded by
  default**; header is a `<button>` with `aria-expanded`; toolbar has **Expandir todo / Contraer
  todo**. Collapse state is per-page-view (resets when filters/page change is acceptable; keep it
  simple and deterministic).
- **Row styling:** a left border or tint by decision (green keep / red remove), subtle zebra within a
  group is not needed; header row visually distinct; sticky `<thead>`; table lives in a scroll
  container with a sensible max height so toolbar + header stay visible; hover state; visible
  `:focus-visible`.
- **Pagination:** reuse `PaginationControls`; default page size 25 groups, options 10/25/50/100
  (consts in `data/dedupLabels.ts`).
- **Empty state:** when filters match nothing, a friendly centred message with a Lucide icon and the
  "Limpiar filtros" button. When the analysis returns zero groups, say so plainly instead of rendering
  an empty table.

**U4. Export.** Keep the three exports (CSV, GeoJSON puntos, GeoJSON enlaces) but render them as one
compact **button group in the context bar** (icon + short label, the longer description in a
`title`), with the per-format pending/spinner state already implemented. Do not change `dedupClient`
behaviour.

**U5. Structure and code rules.**
- Split the 145-line `DedupDashboard` into small components; the dashboard only orchestrates state.
  Suggested (names are yours to adjust): `DedupConfigCard`, `DedupContextBar`, `DedupTabs`,
  `DedupLoadingCard`, `DedupSummaryTab` (`DedupKpiCards`, `DedupDecisionMatrix`, `DedupReasonTable`),
  `DedupGroupsTab` (`DedupGroupToolbar`, `DedupGroupTable`, `DedupGroupHeaderRow`, `DedupMemberRow`),
  `useDedupGroupFilters`. Delete files that become unused (`DedupSummaryTable`, `DedupGroupList`, and
  any CSS module no longer referenced); no dead code.
- Pure filter/sort/derive logic goes in **`domain/groupFilters.ts`** (no React): `filterGroups(groups,
  criteria)`, `sortGroups(groups, order)`, `countByDecision(group)`, `hasReviewRows(group)`,
  `listFuentes(groups)`; criteria/sort/option values are const objects in `constants.ts` (`GroupSort`,
  `DecisionFilter`, ...), never raw strings. Summary-derived numbers for KPI cards/percentages: add pure
  helpers in `domain/summaryView.ts` (totals per decision/fuente, percentage with safe zero-division),
  not in components.
- Spanish text everywhere, static labels/tooltips in `data/`, no inline styles, Lucide icons only, no
  emoji/unicode glyph icons, `.module.css` per component, design tokens not hard-coded colours (a few
  rgba tints derived from the accent tokens are fine).
- Keep the existing behaviours: password never shown/stored, `key={resultId}` pagination reset idea
  (adapt it), profile selector, province id validation, error handling.

## Required tests
`tests/unit/modules/address-dedup/`, Vitest, AAA, real data shapes, no UI mocking of the pure logic:
- `groupFilters.test.ts`: each criterion alone (decision, reason, fuente, search on urn / padron /
  street / locality, case-insensitive + trimmed); **combined criteria must be satisfied by the same
  member** (a group where member A is REMOVE and member B is ANTEL-KEEP must NOT match
  decision=REMOVE + fuente=ANTEL-with-KEEP-only); matching group keeps all its members; "Solo para
  revisar"; each sort order incl. tie-breaks (stable, then groupId asc); empty input; no match; whitespace-only
  search = no filter; `listFuentes` unique + sorted + includes empty-fuente rows as the "other" bucket.
- `summaryView.test.ts`: totals per decision/fuente/row/column, percentage rounding, zero total (no NaN),
  review-count from `byReason`.
- Update/replace `summary.test.ts` etc. only if the domain they test changed (it should not have).
- **E2E (Playwright)**: add `tests/e2e/address-dedup.spec.ts` following `tests/e2e/README.md`
  conventions (route-mocked API, console-error guard). It mocks `POST /api/m/address-dedup/analyze`
  with a fixture of ~6 groups (include one `KEPT_ALONGSIDE_PROTECTED` group, an IDE row, a row with empty
  fuente) and covers: config card shown alone before a run; run → context bar + Resumen tab with KPI
  cards and both tables; switch to Grupos; search narrows; decision filter narrows; "Solo para revisar"
  narrows to the amber group; clear filters; expand/collapse all; export button triggers a request to
  `/api/m/address-dedup/export` with the chosen format; "Editar parámetros" re-expands the form. Also
  **save screenshots** of: config state, Resumen tab, Grupos tab (default), Grupos tab filtered, to
  `C:\Users\g611045\AppData\Local\Temp\claude\c--Alekos-Projects-gis-tools\947681d9-9c0b-4b39-8f12-44d3961eae71\scratchpad\dedup-ui\` and list the paths in your report so the orchestrator can view them.
  This e2e spec is part of the module's **deletion set**: say so in
  `docs/tools/ADDRESS_DEDUP_MODULE.md` and in `module_authoring`-style notes if that doc lists the deletion set.
  Unit tests for the components themselves are NOT required (no testing-library in the repo; do not add it).

## Out of scope
New dependencies; virtualised tables; map view; changing exports/CSV columns; server/query changes;
persisting UI state (filters, tab) in storage/URL; editing core `ui-kit` components; i18n framework;
fixing the data discrepancy in the numbers (the orchestrator is looking at that separately).

## Definition of done: full gauntlet, real output pasted
```
npm run modules:routes && npm run modules:routes:check
npm run lint          # 0 errors, 0 warnings
npm test              # all green; report counts
npm run build         # clean
npm run doctor        # zero findings (fix with code, never a suppression)
npm run test:e2e      # at least the new spec green; report the whole run's result honestly
```
No gate weakened, no assertion relaxed, no `eslint-disable`/`@ts-ignore`. Audit for dead code, unused
exports/imports/CSS before reporting. Re-confirm the module is still deletable (no edits outside the
allowed set; the e2e spec is added to the deletion set).

## Reporting
Append "UI redesign" to `.agents/handoff/TO_ORCHESTRATOR.md`: files created/deleted, gauntlet output
verbatim, screenshot paths, deviations, anything skipped or partial stated plainly, questions.

Do not commit.


---

## Brief 4 — Resolve sources by name, no hardcoded `id_font` (branch `feat/module-address-dedup`, uncommitted, do NOT commit)

Binding rules: `AGENTS.md`, `.agents/rules/*.md` (coding_guidelines, testing_standards, module_authoring). npm is not on PATH: use `C:\Alekos\Tools\node24portable` (see `.agents/rules/portable_node.md`).

### Decision (user-mandated)
The query must NOT hardcode numeric `id_font` values. Verified on prod: `carto.v_address_build` has `id_font`/`name_font` (1=IDE, 9=ANTEL, 10=TLK), but ids must not live in our code. Source selection is by `name_font` text.

### Change
- `src/modules/address-dedup/constants.ts:47` — delete `DETECTION_FONT_IDS`.
- `types.ts:13` — replace `fontIds: ReadonlyArray<number>` with `detectionFuentes: ReadonlyArray<string>`.
- `services/DedupOrchestrator.ts:8` — set `detectionFuentes` = de-duplicated union of `DedupRules.REMOVABLE_FUENTES` and `DedupRules.PROTECTED_FUENTES` (derive; no new literal list).
- `services/queries/duplicateAnalysisQuery.ts:61,199` — `WHERE b.name_font = ANY($1::text[])`; bind `parameters.detectionFuentes`; update the `$1` doc comment (`text[] detection fuentes`) and drop the "ANTEL, IDE, TLK" inline note. Keep `$2..$8` numbering unchanged.
- Check `runDuplicateAnalysis.ts`, `PgAddressRepository.ts`, API handlers/UI/docs (`docs/tools/ADDRESS_DEDUP_MODULE.md`) for any mention of font ids and update.
- Tests: `tests/unit/modules/address-dedup/pgliteHarness.ts:66` and `duplicateAnalysisQuery.test.ts:520` (the "widened fonts" case: switch to a fuente-name list, e.g. add a fifth source name present in the fixture, and assert it is detected only when listed). The pglite fixture view may still carry `id_font` columns; leave them if harmless but nothing in the query may reference them. Add a test: a source absent from `detectionFuentes` is excluded even if its rows exist. Differential test vs v3 SQL must still show zero mismatches at defaults (v3 SQL uses ids; map ids to names only inside the test fixture).

### Out of scope
Any rule/key/decision change; UI changes; commit.

### Definition of done
Full gauntlet (lint, build, doctor, unit, e2e) green; paste real output; report any skipped gate plainly. Report to `.agents/handoff/TO_ORCHESTRATOR.md`.


---

## Brief 5 — Group table shows every match-key column + top/bottom horizontal scrollbars (branch `feat/module-address-dedup`, uncommitted, do NOT commit)

Binding rules: `AGENTS.md`, `.agents/rules/*.md` (coding_guidelines: modular CSS, no inline styles, no hard-coded colours; testing_standards; module_authoring). npm not on PATH: use `C:\Alekos\Tools\node24portable`.

### Goal
In the groups table (`ui/DedupGroupTable.tsx`, `ui/DedupMemberRow.tsx`, `ui/DedupGroupHeaderRow.tsx`, `data/dedupLabels.ts` `GROUP_TABLE_COLUMNS`), show every field that enters `match_key` (`services/queries/duplicateAnalysisQuery.ts` lines 65-96), so the user can see why rows were grouped. Add a horizontal scrollbar above AND below the table.

### Match-key fields, in key order
province (`name_province`), province_code (`code_province`), locality_code (`rs_censal_locality_code`), locality (`rs_censal_locality_name`), postal_code, padron_locality-or-geo-bucket, street_name (`rs_name`), street_number, letter, square, sandlot, km, padron, type_padron, rs_reftramo.

Already in `AnalysisRow`: province, locality, street_name, street_number, letter, square, sandlot, km, padron, type_padron, postal_code, raw_rs_censal_locality_code, rs_reftramo.
MISSING from the SQL output, must be added: `province_code`, `padron_locality` (= `pad_cadastral_locality_name`, NOT `rs_cadastral_locality_name`), and `padron_locality_or_geo` (the effective segment actually used in the key: `coalesce(padron_locality, 'GEO:'||round(...))` with the same `$5`/`$6` rounding as the key; extract that expression ONCE in the `keyed` CTE and reuse it in `match_key` so the two cannot drift). Also expose `match_key` itself as a column (shown in the group header row as a copyable/title value, not a table column).

### Binding decisions
- Add the new fields to the final SELECT and to `AnalysisRow` (types.ts) and `mapAnalysisRow`. Append them AFTER existing columns in the SELECT.
- CSV/GeoJSON export column list and order must stay byte-identical to today (v3 header compatibility). Do not add the new fields to exports. Add/keep a test pinning the export header.
- Table columns become: Fuente, URN, then the 15 key columns above (use the effective padron_locality_or_geo column in place of a separate padron_locality column), then Decisión, Motivo. Remove the combined "Dirección"/"Padrón" cells (`describeAddress`/`describePadron` in `domain/rowFormat.ts`) only if they become unused; delete dead code and their tests if so.
- Null/empty cell renders as an em dash via one shared helper; no raw "null". Values shown raw (not normalised) — except the geo-or-padron-locality column.
- Column labels in Spanish, in `data/dedupLabels.ts`, one source of truth. Header row `colSpan` must follow the column count (derive, no literal).
- Within a group the key-column values are identical by construction (except cosmetic case/whitespace): fine, show them per row anyway.
- Scrollbars: a thin top scroller `div` (overflow-x:auto, inner spacer div whose width tracks the table's `scrollWidth` via ResizeObserver) synchronised two-way with the table's own scroller (guard against scroll-event feedback loops). The bottom scrollbar is the real one on the table scroller. Hide the top bar when there is no overflow. Implement as a small reusable hook/component in the module (e.g. `useSyncedHorizontalScroll` + `DedupScrollFrame`), modular CSS, theme tokens only, keyboard-focusable only if needed for a11y. Table needs `white-space: nowrap` cells and a min-width so it overflows instead of squashing; keep the existing sticky toolbar behaviour and the phone-width layout working (page itself must not scroll horizontally).
- Performance: ~1,200 groups / ~2,500 rows is the real size; do not add per-row hooks or ResizeObservers.

### Required tests (by name)
- query: each new column present and correct (province_code, padron_locality, padron_locality_or_geo incl. GEO fallback with padron / without padron rounding, match_key equal across members of a group). pglite fixture may need `code_province`/`pad_cadastral_locality_name` values.
- `mapAnalysisRow`: maps new fields; null stays null.
- export: header row unchanged (pinned).
- unit: empty-cell helper; column-count derivation.
- e2e (`tests/e2e/flows/address-dedup.spec.ts`, fixtures in `tests/e2e/fixtures/dedupFixtures.ts`): table shows key headers; top and bottom scrollbars exist when the viewport is narrow; scrolling one moves the other; no page-level horizontal scroll at 360px. Update fixtures with the new fields.
- Update `docs/tools/ADDRESS_DEDUP_MODULE.md`.

### Out of scope
Changing grouping rules, exports, sticky columns, column picker/visibility toggles, commit.

### Definition of done
Full gauntlet (routes check, lint, unit, build, doctor, e2e) green, real output pasted; unverified items stated plainly. Report appended to `.agents/handoff/TO_ORCHESTRATOR.md`.


---

## Brief 6 — Top scrollbar not visible / columns cut off at desktop width (branch `feat/module-address-dedup`, uncommitted, do NOT commit)

Binding rules: `AGENTS.md`, `.agents/rules/*.md`. npm via `C:\Alekos\Tools\node24portable`.

### Symptom (user, Windows 11, Edge/Chrome, desktop width ~1280)
At the top of the groups table there is NO visible horizontal scrollbar; the table is clipped on the right (headers up to "NÚMERO" then cut, no right border of the frame). The only scrollbar would be at the bottom of a long table, out of view. Brief 5's e2e only proved the bars at 360px.

### Hypotheses (orchestrator read of `ui/DedupScrollFrame.tsx`, `DedupScrollFrame.module.css`, `useSyncedHorizontalScroll.ts`, `DedupGroupTable.module.css`, `DedupGroupsTab.module.css`) — YOU MUST CONFIRM WITH EVIDENCE, do not assume
1. Overlay scrollbars (Win11 default): `.topScroller` content is a 1px-high spacer, so with an overlay scrollbar the top scroller is ~1px high and effectively invisible.
2. An ancestor lets the frame grow to the table's `max-content` width (flex/grid item with `min-width:auto`, e.g. the `.stack` or tab panel / dashboard containers up the tree), so the frame never overflows (`hasOverflow` false → top bar `display:none`) while some ancestor or the page clips/scrolls instead. The missing right frame border suggests this.
3. Both.

### Required
- Reproduce first: write/extend a Playwright check at 1280x800 (and 1920x1080) with real data from `tests/e2e/fixtures/dedupFixtures.ts`, assert the frame's `getBoundingClientRect().right <= viewport width`, `scrollWidth > clientWidth` on the content scroller, and the top bar is visible with height >= 12px. To emulate Win11 overlay scrollbars launch Chromium with `--enable-features=OverlayScrollbar` (or equivalent) in a dedicated test/project config; keep default config otherwise. Paste the failing numbers BEFORE fixing, and the passing ones after. If neither hypothesis is the cause, report the real cause.
- Fix whatever the evidence shows. Expected shape: (a) force the frame and every ancestor on the path to be width-constrained (`min-width: 0` on flex/grid items; do not use `overflow:hidden` on ancestors to hide the problem); (b) make both scrollbars always visible and at a fixed, tappable height independent of OS overlay setting — style with `scrollbar-width`/`scrollbar-color` and `::-webkit-scrollbar` (height 12-14px, theme tokens, no hard-coded colours) on `.topScroller` and `.scroller`, and give the top scroller an explicit height rather than relying on the 1px spacer.
- Also make the group header toggle label (`Grupo N · x filas ...`) stay visible while scrolling horizontally (`position: sticky; left: 0` on the header's content cell/span) — that was a flagged follow-up and is now in scope.
- Keep: no page-level horizontal scroll, phone layout, export untouched, no inline styles (imperative width on the spacer via ref is already accepted).

### Tests
- e2e as above (desktop widths, frame within viewport, top bar visible with height, scroll sync still works, header label sticky: after scrolling the content by 400px the header label's bounding left is still within the frame).
- Keep all existing tests green.

### Out of scope
Grouping rules, exports, sticky data columns, column picker, commit.

### Definition of done
Full gauntlet (routes check, lint, unit, build, doctor, e2e) green with real output pasted; state root cause with evidence; report appended to `.agents/handoff/TO_ORCHESTRATOR.md`.


---

## Brief 7 — Removal candidates with attached internal/apartment units are never checked (branch `fix/address-dedup-internal-units`, cut from `main`)

Binding rules: `AGENTS.md`, `.agents/rules/*.md` (coding_guidelines, testing_standards, module_authoring, code_review_standards). npm is not on PATH: use `C:\Alekos\Tools\node24portable` (see `.agents/rules/portable_node.md`).

### Context — why this exists

This module is a port of `CGEO-2192 prod/v3/find_removal_candidates.sql` (see the header comment of `duplicateAnalysisQuery.ts`). While preparing the actual deletion script for that ticket (`CGEO-2192/prod/v3/delete_removal_candidates.sql`, outside this repo), I found an existing production function, `carto.baja_direccion` (dev DB only, never deployed to preprod/prod), that performs single-address deletions properly — and it **refuses to delete a door ("puerta") address that has internal/apartment sub-units attached** (`carto.internal_address_access_point`) unless explicitly told to cascade. Deleting a door without its internals orphans those apartment-level addresses.

Neither v3's SQL nor this module's port of it ever checks this. Confirmed directly against `pg-prod` on 2026-10-05: of the ~1,670 urns this module (and the v3 script) currently classify as a removal candidate in Flores, **250 (248 TLK, 2 ANTEL) have at least one internal unit attached** — something nobody evaluated for duplication on its own. The user independently found the same 1,670-urn number from this module's dashboard before I reported this, so the two are confirmed to agree today and must keep agreeing after this fix.

### Decision (orchestrator, binding)

A removable-fuente row that would otherwise be judged REMOVE, but has at least one attached internal unit, is reclassified: `decision_reason = HAS_INTERNAL_UNITS`, `decision = KEEP`. This mirrors `carto.baja_direccion`'s own default (refuse, don't cascade) rather than deciding anything new. It does **not** evaluate the internal units themselves for duplication — that stays out of scope, exactly as today.

The override applies **only** to the three reasons that currently map to REMOVE (`REDUNDANT_WITH_MATCHED`, `REDUNDANT_NOT_LOWEST_URN`, `REDUNDANT_WITH_PROTECTED`). A row that is already KEEP for another reason (`PROTECTED_SOURCE`, `INFRA_MATCHED`, `NO_DUPLICATE`, `LOWEST_URN_KEPT`, `KEPT_ALONGSIDE_PROTECTED`) keeps that reason even if it happens to have internal units — there is nothing to intercept, since nothing was going to be removed.

Resolution path (urn → internal units), since this module only ever joins `v_address_build` by `urn` and has never touched raw address ids before: `carto.addresses_master.urn` → `addresses_master_id` → `carto.address.id_address_master` → `address.id` → `carto.internal_address_access_point.id_access_point`.

### Change

**1. `services/queries/duplicateAnalysisQuery.ts`**
- New CTE alongside `stc_urns`/`npd_urns`:
  ```sql
  internal_unit_urns AS (
    SELECT DISTINCT am.urn
    FROM carto.addresses_master am
    JOIN carto.address a ON a.id_address_master = am.addresses_master_id
    JOIN carto.internal_address_access_point iaap ON iaap.id_access_point = a.id
  )
  ```
- In `pool`: `LEFT JOIN internal_unit_urns iu ON iu.urn = k.urn` and `(iu.urn IS NOT NULL) AS has_internal_units`, same style as `matched_serv_cto_tlk` / `matched_nap_physical_device`.
- Rename the current `reasoned` CTE to `reasoned_raw` — **do not touch its CASE, branch order, or conditions.** Add a new `reasoned` CTE on top that only overrides the three REMOVE-bound reasons:
  ```sql
  reasoned AS (
    SELECT *,
           CASE
             WHEN fuente = ANY($3::text[]) AND has_internal_units AND decision_reason IN (
                    '${DecisionReason.REDUNDANT_WITH_MATCHED}',
                    '${DecisionReason.REDUNDANT_NOT_LOWEST_URN}',
                    '${DecisionReason.REDUNDANT_WITH_PROTECTED}')
               THEN '${DecisionReason.HAS_INTERNAL_UNITS}'
             ELSE decision_reason
           END AS decision_reason
    FROM reasoned_raw
  )
  ```
  `decided`'s existing `decision_reason IN (...)` → `REMOVE` mapping is untouched; `HAS_INTERNAL_UNITS` is not in that list, so it resolves to `KEEP` for free.
- Add `d.has_internal_units` to the final SELECT, next to `d.matched_serv_cto_tlk, d.matched_nap_physical_device`.
- No new bound parameter — `$1..$8` stay exactly as they are.

**2. `constants.ts`**: add `HAS_INTERNAL_UNITS: "HAS_INTERNAL_UNITS"` to `DecisionReason`; append to `REASONS_BY_DECISION[Decision.KEEP]`. Add one array, e.g. `REVIEW_REASONS = [DecisionReason.KEPT_ALONGSIDE_PROTECTED, DecisionReason.HAS_INTERNAL_UNITS]` — the single place "needs human review" is defined, consumed by both places below instead of each hardcoding `KEPT_ALONGSIDE_PROTECTED` directly.

**3. `data/dedupLabels.ts`**: `REASON_LABELS[HAS_INTERNAL_UNITS]` = `"Tiene unidades internas (revisar)"`; `REASON_DESCRIPTIONS[HAS_INTERNAL_UNITS]` = `"La puerta tiene direcciones internas (apartamentos/unidades) asociadas; eliminarla las dejaría huérfanas. Se conserva para revisión manual, fuera del alcance de esta herramienta."`

**4. `types.ts`**: `AnalysisRow` gains `has_internal_units: boolean`, same position as the SQL change.

**5. `services/queries/mapAnalysisRow.ts`**: map the new column.

**6. `domain/groupFilters.ts`**: `hasReviewRows` matches any reason in `REVIEW_REASONS`, not only `KEPT_ALONGSIDE_PROTECTED`.

**7. `domain/summaryView.ts`**: `reviewCount` sums `byReason` over `REVIEW_REASONS`.

**8. `domain/export.ts`**: do **not** add `has_internal_units` to the CSV/GeoJSON column list — same rule Brief 5 set for its new columns, keep the exported header byte-identical to v3. Re-confirm the pinned header test still passes unchanged.

**9. `docs/tools/ADDRESS_DEDUP_MODULE.md`**: document the new reason, the new column, and that this closes a real gap found via CGEO-2192 (name the ticket).

### Test fixture changes — `tests/unit/modules/address-dedup/pgliteHarness.ts`

The harness only models `carto.v_address_build` plus the two infra-match tables today; nothing needed urn→id resolution before this. Add, minimally (same simplification level as the existing two infra tables — not a full schema mirror):
- `CREATE TABLE carto.addresses_master (addresses_master_id serial PRIMARY KEY, urn text)`
- `CREATE TABLE carto.address (id serial PRIMARY KEY, id_address_master int)`
- `CREATE TABLE carto.internal_address_access_point (id_access_point int, id_internal_address int)`
- Add all three to `RESET_SQL`'s `TRUNCATE` list.
- New helper `markHasInternalUnits(database, urn)`, mirroring `markMatchedInServCto` / `markMatchedInNapDevice`: creates the backing `addresses_master`/`address` rows for that urn and inserts one `internal_address_access_point` row referencing it. `insertAddress` itself must stay untouched — most fixtures never call this helper, and the join is a `LEFT JOIN`, so no backing row means `has_internal_units = false`, exactly like today's behavior for urns never passed to `markMatchedInServCto`.

### Required tests (by name) — `duplicateAnalysisQuery.test.ts`

- A removable row that would be `REDUNDANT_NOT_LOWEST_URN` → with `markHasInternalUnits`, becomes `HAS_INTERNAL_UNITS` / `KEEP`.
- Same for a row that would be `REDUNDANT_WITH_MATCHED`.
- Same for a row that would be `REDUNDANT_WITH_PROTECTED` (requires `protectedSiblingRemovesLone: true`).
- A removable row with internal units but `dup_group_size = 1` → stays `NO_DUPLICATE` (proves the override is scoped to REMOVE-bound reasons only, not "has internal units → always flag").
- A removable row with internal units that also has an infra match → stays `INFRA_MATCHED` (matched wins).
- A protected-fuente (IDE) row with internal units in a duplicate group → stays `PROTECTED_SOURCE`.
- `has_internal_units = false` for every row where `markHasInternalUnits` was never called (no leakage across urns).

### Other test updates
- `groupFilters.test.ts`: "Solo para revisar" matches a group whose only review-worthy row is `HAS_INTERNAL_UNITS`, with no `KEPT_ALONGSIDE_PROTECTED` row present.
- `summaryView.test.ts`: `reviewCount` sums both reasons.
- `export.test.ts`: re-confirm the CSV header is still byte-identical.
- e2e (`tests/e2e/flows/address-dedup.spec.ts` + fixtures): add one `HAS_INTERNAL_UNITS` row to the fixture group set so the Motivo filter and the amber "Revisar" badge each get a real case beyond `KEPT_ALONGSIDE_PROTECTED`. Pointer only — match the existing spec's style, not prescriptive of exact assertions.

### Out of scope
- Evaluating internal/apartment addresses themselves for duplication — still entirely unaddressed.
- Any UI redesign beyond the new reason flowing through existing generic mechanisms (`REASON_FILTER_OPTIONS`, `DedupReasonTable` already iterate `Object.values(DecisionReason)` — confirm, don't rebuild).
- Changing the `$1..$8` parameter count, order, or meaning.
- Commit.

### Definition of done
Full gauntlet, real output pasted:
```
npm run modules:routes:check
npm run lint
npm test
npm run build
npm run doctor
npm run test:e2e
```
No gate weakened, no assertion relaxed, no `eslint-disable`/`@ts-ignore`. Report appended to `.agents/handoff/TO_ORCHESTRATOR.md` as "Brief 7 report".

Do not commit.


---

## Fix round 1 for Brief 7 — review-only groups vanish from the default view

Gauntlet re-verified green (routes/lint/542 tests incl. the new ones/build/doctor 100/`test:e2e` 48/48). The query and classification change itself is correct — I independently re-ran the real pg-prod numbers and they match what the dashboard now shows (1,421 eliminar). One real bug, found by comparing those prod numbers group-by-group, not by reading the diff alone.

**This one is mine, not yours** — the brief never mentioned `output_groups`, so there was nothing in scope telling you to look at it.

## F1 [BLOCKER] — a group with zero remaining REMOVE rows disappears entirely, taking its review rows with it

`output_groups` (`duplicateAnalysisQuery.ts:202-207`) only keeps a group when it has a `REMOVE` row, or (opt-in) when `$8 = ALL_DUPLICATE_GROUPS`. Before this brief, every group with a removable member that wasn't the sole survivor produced at least one `REMOVE` row, so this never bit. Now it does: when **every** removable member of a group gets reclassified to `HAS_INTERNAL_UNITS`, the group has no `REMOVE` row left at all — and vanishes from `output_groups`, so none of its rows reach the client. Confirmed directly against pg-prod: **49 of 843 groups, 248 of 250 `HAS_INTERNAL_UNITS` rows**, are in this state today. (The dashboard's "Para revisar: 1" is real but almost meaningless — it's only the 2 `HAS_INTERNAL_UNITS` rows whose group happens to still have an unrelated surviving `REMOVE` member. The other 248 are not undercounted, they are **not there at all** — not in `Grupos`, not in any KPI, not in CSV/GeoJSON export.)

> Someone reads "Para revisar: 1", concludes there's nothing to look at, and the 248 addresses that most need a human decision (their only reason nothing is being deleted is an attached apartment) are never looked at by anyone, with no indication they exist.

The same scoping gap is latent for `KEPT_ALONGSIDE_PROTECTED` too — a 2-member group (one protected, one removable-and-lowest-urn) produces zero `REMOVE` rows today and would have been invisible before this brief as well. It happened not to bite visibly before (the very first dashboard read showed "Para revisar: Ninguna" — plausibly already wrong, just small enough not to be noticed). Brief 7 didn't create this bug; it made the existing one large enough to see.

**Fix:** `output_groups` must also keep a group containing any row whose `decision_reason` is review-worthy, regardless of whether a `REMOVE` row survives elsewhere in it:

```sql
output_groups AS (
  SELECT DISTINCT match_key
  FROM decided
  WHERE decision = '${Decision.REMOVE}'
     OR decision_reason = ANY(ARRAY['${DecisionReason.KEPT_ALONGSIDE_PROTECTED}', '${DecisionReason.HAS_INTERNAL_UNITS}'])
     OR ($8::text = '${DedupScope.ALL_DUPLICATE_GROUPS}' AND dup_group_size > 1)
)
```

Use `REVIEW_REASONS` (the constant added in Brief 7) to generate that `ARRAY[...]` list rather than hand-duplicating the two reason names a third time — interpolate it the same way the file already interpolates other `DecisionReason` constants, your call on the exact mechanism (map-and-join vs. two literals), but it must read from `REVIEW_REASONS`, not introduce a fourth place that lists these two reasons by hand.

**Required test (by name), `duplicateAnalysisQuery.test.ts`:** a group with two removable members, both ending up `HAS_INTERNAL_UNITS` (no `REMOVE` anywhere in the group) → both rows are still present in the query's output under the **default** `REMOVAL_GROUPS` scope. This is the exact case that was missing from Brief 7's own test list — add it, don't just fix the SQL.

**Also fix the KPI/report consumers**, since they currently assume "if it's not a REMOVE-having group, scope decides visibility" implicitly by only ever seeing what the query already filtered:
- Re-run `groupFilters.test.ts`'s "Solo para revisar" case for this specific shape (group with *only* `HAS_INTERNAL_UNITS` members, no `REMOVE`) — confirm it still toggles the group in, now that it's actually reachable.
- `summaryView.test.ts`: add a case where `reviewCount` includes rows from a group that has no `REMOVE` member at all.

### Out of scope
Any other change to `output_groups`'s `ALL_DUPLICATE_GROUPS` branch or to scope semantics beyond adding the review-reason condition. Commit.

### Definition of done
Full gauntlet again, real output pasted. Re-paste the live dashboard numbers (groups/rows/eliminar/conservar/para revisar) after the fix and confirm `groups_fully_deferred` (49) and `deferred_rows_in_fully_deferred_groups` (248) from this message are now visible in the UI, not just true in the database. Report as "Fix round 1 report" in `TO_ORCHESTRATOR.md`.

Do not commit.


---

## Brief 8 — clicking a KPI card shows its matching records (branch `feat/address-dedup-kpi-drilldown`, cut from `main`)

Binding rules: `AGENTS.md`, `.agents/rules/*.md` (coding_guidelines, testing_standards, module_authoring, code_review_standards). npm via `C:\Alekos\Tools\node24portable`.

### Goal
User-requested: clicking a KPI card on the Resumen tab (`Grupos`, `Filas`, `A eliminar`, `A conservar`, `Para revisar`) jumps to the Grupos tab already filtered to exactly that KPI's own rows — reusing the Grupos tab's existing filter machinery as the "summary of matching records" view, not building a second one.

### Decision (orchestrator, binding)

**No new view.** The Grupos tab (`DedupGroupsTab` + `GroupFilterCriteria` + `filterGroups`) already is a filterable table of matching records — a KPI click is a shortcut into it with a preset, full-replacement filter, not an incremental patch.

Five presets, one per card, each a **complete** `GroupFilterCriteria` (not merged onto whatever filter happened to be active before — clicking `A eliminar` after `Para revisar` was active must not leave `reviewOnly` stuck on):

| Card | Preset |
|---|---|
| `Grupos` | `EMPTY_CRITERIA` (show everything) |
| `Filas` | `EMPTY_CRITERIA` (same — there's no row-only view distinct from groups) |
| `A eliminar` | `{ ...EMPTY_CRITERIA, decision: DecisionFilter.REMOVE }` |
| `A conservar` | `{ ...EMPTY_CRITERIA, decision: DecisionFilter.KEEP }` |
| `Para revisar` | `{ ...EMPTY_CRITERIA, reviewOnly: true }` |

Clicking any card also switches the active tab to `DedupTab.GROUPS`. Clicking `Para revisar` when its value is "Ninguna" (0 rows) is allowed — it just lands on the Grupos tab's existing empty state, no special-casing needed.

### Change

**1. `ui/useDedupGroupFilters.ts`** — add `applyPreset(criteria: GroupFilterCriteria): void` alongside the existing `updateCriteria` (merge) and `clearFilters` (reset to `EMPTY_CRITERIA`): sets `criteria` to the given value wholesale and calls the same `resetView(1)` the other setters already use. Do not change `updateCriteria`'s merge behavior — the Grupos tab's own toolbar still needs incremental patching; this is a new, distinct, full-replacement setter for the drill-down path only.

**2. `ui/DedupResultsView.tsx`** — already owns both `activeTab`/`setActiveTab` and `groupFilters` (the one `useDedupGroupFilters` instance, kept alive across tab switches). Add one handler:
```ts
const handleKpiSelect = (criteria: GroupFilterCriteria) => {
  groupFilters.applyPreset(criteria);
  setActiveTab(DedupTab.GROUPS);
};
```
Pass it to `DedupSummaryTab` as a new prop (e.g. `onKpiSelect`).

**3. `ui/DedupSummaryTab.tsx`** — accept `onKpiSelect` and forward to `DedupKpiCards`. (Not to `DedupDecisionMatrix`/`DedupReasonTable` — those stay out of scope, see below.)

**4. `ui/DedupKpiCards.tsx`** — accept `onKpiSelect: (criteria: GroupFilterCriteria) => void`, pass each card its own `onClick={() => onKpiSelect(PRESET)}` using the table above. Import `EMPTY_CRITERIA`/`DecisionFilter` from `domain/groupFilters` / `constants` as needed — do not hand-roll a second criteria shape.

**5. `ui/DedupKpiCard.tsx`** — add optional `onClick?: () => void`. When present, render the card as a real `<button type="button">` (keyboard operable for free) instead of a `<div>`, keeping the exact same visual content and the `glass-panel`/tone/dimmed classes; when absent, render exactly as today (plain, non-interactive `<div>` — don't force every future caller of this component to be clickable). Add a `.clickable` modifier in `DedupKpiCard.module.css` with a hover and `:focus-visible` affordance (subtle lift/brighten using existing design tokens — no new colours, no inline styles), applied only when `onClick` is set.

### Out of scope
- `DedupDecisionMatrix` and `DedupReasonTable` are not part of this request — do not make their cells/rows clickable.
- Changing what any preset's filter actually matches (that's the existing, already-tested `filterGroups`/`groupFilters` logic — untouched).
- Persisting the drill-down filter across a page reload or a new analysis run (`DedupResultsView` is already remounted per-result with a fresh `key`, per its own doc comment — leave that behavior as is).
- Commit.

### Required tests
- e2e (`tests/e2e/flows/address-dedup.spec.ts`): for at least `A eliminar` and `Para revisar`, click the KPI card from the Resumen tab and assert: the Grupos tab is now active, the corresponding filter select/toggle reflects the preset (e.g. Decisión = Eliminar, or the "Solo para revisar" toggle is on), and the visible group count matches. One more case: with a non-empty filter already active on the Grupos tab (e.g. from a prior `Para revisar` click), clicking `A eliminar` next must show the `A eliminar` preset only — not a merge of both (proves `applyPreset` fully replaces, not patches).
- No unit test required for `useDedupGroupFilters` itself (a hook, not a pure `domain/` function — same rule already applied to this module: no React/hook testing-library infra here).

### Definition of done
Full gauntlet, real output pasted:
```
npm run modules:routes:check
npm run lint
npm test
npm run build
npm run doctor
npm run test:e2e
```
No gate weakened, no assertion relaxed. Update `docs/tools/ADDRESS_DEDUP_MODULE.md` with the new interaction. Report appended to `.agents/handoff/TO_ORCHESTRATOR.md` as "Brief 8 report".

Do not commit.


---

## Brief 9 — execute real deletions for confirmed REMOVE candidates (branch `feat/address-dedup-removal-execution`, cut from `main`)

**This is the highest-stakes brief this module has had.** It adds the module's first write path against production data. Read it twice before starting. Binding rules: `AGENTS.md`, `.agents/rules/*.md` (all of them, not just the usual four — this touches security-sensitive code). npm via `C:\Alekos\Tools\node24portable`.

### Context

User, after confirming the Brief 7 fix: "eventually I need to integrate the deletion sql you refactored [in CGEO-2192]." That refactored script is `CGEO-2192/prod/v3/delete_removal_candidates.sql` (outside this repo) — it mirrors `carto.baja_direccion`'s simulate → fingerprint → explicit confirm → audit-log pattern, scoped to the live-recomputed REMOVE set, explicitly excluding anything with attached internal units. This brief brings that same mechanism into gis-tools as a real feature instead of a one-off script.

**Explicit, non-negotiable scope boundary (confirmed with the user 2026-10-05):** only rows with `decision = REMOVE`, from a **freshly recomputed** analysis, are ever eligible. Rows reclassified to `HAS_INTERNAL_UNITS` or `KEPT_ALONGSIDE_PROTECTED` ("Para revisar") **must stay untouched** — the user was explicit: "for the time being, those addresses that have internal addresses associated should stay untouched." This is not a UI checkbox or a default that can be toggled off — it must be structurally impossible for this code path to delete a non-`REMOVE` row, enforced in the query/service layer, not just hidden in the UI.

### Architecture (binding)

The existing read path is deliberately hardened: `PgAddressRepository.runDuplicateAnalysis` opens `BEGIN READ ONLY` specifically "so a write attempt is refused by Postgres itself, not by this code" (see its own doc comment). **Do not weaken or reuse that method for writes.** Add new, separate methods/classes for the write path so the existing read-only guarantee stays intact and auditable on its own.

**1. New repository methods** (new file(s) under `services/`, e.g. `services/RemovalRepository.ts` + `PgRemovalRepository.ts`, following the `AddressRepository`/`PgAddressRepository` interface-plus-implementation split already in this module):

- `simulateRemoval(request: RepositoryRequest): Promise<RemovalPlan>` — runs inside `BEGIN READ ONLY` (reuse that discipline, just a new query). Re-runs `DUPLICATE_ANALYSIS_SQL` fresh (same parameters as a normal analyze call — never trust a cached/previous result, this module's own query has repeatedly been shown to return different numbers minutes apart against live prod), filters server-side to `decision = '${Decision.REMOVE}'` only, then resolves each surviving urn to its row across `carto.addresses_master` → `carto.address` → `carto.access_point` → `carto.compact_address` → `carto.territorial_unit_access_point` (same join path as Brief 7's `internal_unit_urns`, plus the full snapshot shape `carto.baja_direccion` builds — read that function if you need the exact shape, it's in the dev DB, schema `carto`). Builds a full JSON snapshot of every row that would be touched, computes `md5(snapshot::text)` as the fingerprint, and returns `{ fingerprint, counts: { total, byFuente }, snapshot }`. **Must also assert, as a hard safety check inside the query, that zero resolved target rows have `decision_reason` outside the three REMOVE-mapped reasons** — if that ever fires, throw, don't silently continue.

- `executeRemoval(request: RepositoryRequest, confirmation: { operationId: string; responsable: string; motivo: string; expectedFingerprint: string }): Promise<RemovalResult>` — opens a **real**, separate read-write transaction (new `Client`/connection, not the read-only one). Steps, in order, all inside one transaction:
  1. `LOCK TABLE` the same 9 tables `baja_direccion_base_v1` locks, `SHARE ROW EXCLUSIVE` — see that function's definition in the dev DB for the exact list.
  2. Abort if `carto.comments_address` or `carto.plural_entity_access_point` have any rows (same global guard).
  3. Recompute the plan **fresh**, exactly as `simulateRemoval` does (same code path — factor the shared logic, don't duplicate the query).
  4. Abort with a clear error if the recomputed fingerprint ≠ `confirmation.expectedFingerprint` — data moved since the user reviewed the plan.
  5. Idempotency: if `confirmation.operationId` already exists in the audit table, compare stored params; identical → return the stored result (no-op, no error); different → abort.
  6. Delete, in this exact order, scoped to the resolved target set: `internal_address_access_point`, `territorial_unit_access_point`, `compact_address`, `internal_address`, `access_point`, `address`, `addresses_master`.
  7. Insert one row into `carto.cgeo_2192_baja_masiva_operacion` — **reuse that exact table** (already created by the CGEO-2192 script if it's been run there first; `CREATE TABLE IF NOT EXISTS` with the identical shape otherwise, so a human auditing deletions later sees one log regardless of whether a given batch ran from the raw SQL script or from this app). Commit.

Shared target-resolution logic between `simulateRemoval` and `executeRemoval` belongs in one function both call — do not fork the query.

**2. `DedupOrchestrator`**: add `simulateRemoval`/`executeRemoval` methods that delegate to the new repository, parallel to the existing `analyze`.

**3. New API routes** (`module.routes.json`, `api/handlers.ts`, following the exact existing `analyze`/`exportResult` pattern — `ValidationResult`, `readXxx` validators, password scrubbed from every error): `POST /api/m/address-dedup/removal/simulate`, `POST /api/m/address-dedup/removal/execute`. `execute`'s body additionally requires `operationId` (server generates it if absent — don't trust a client-chosen UUID blindly without storing it), `responsable`, `motivo` (both non-empty, same validation style as `readConnection`), and `expectedFingerprint`.

**4. UI**: a new "Confirmar y eliminar" action (reachable from the Grupos toolbar or the `A eliminar` KPI from Brief 8 — your call which reads more naturally, state which you picked). Flow: open a dialog requiring `responsable` + `motivo` as text inputs → calls simulate → shows the plan (counts by fuente, the fingerprint) and only then enables "Ejecutar" → on confirm, calls execute with the fingerprint from the simulate response → shows the audit result (counts actually deleted, operation id) and a **visible, permanent-looking reminder** that Solr index removal and the materialized-view refresh are separate manual steps this feature does not perform (same wording `carto.baja_direccion` itself returns). No destructive action may be reachable in fewer than those two explicit steps (simulate, then a separate confirmed execute) — do not collapse them into one click.

### Out of scope
- Touching `HAS_INTERNAL_UNITS` or `KEPT_ALONGSIDE_PROTECTED` rows under any circumstance — not configurable, not a future flag, just absent from this code path entirely.
- Solr index removal, materialized-view refresh.
- Partial/selective execution (deleting one group or one filtered subset at a time) — this brief always targets the full, freshly-computed REMOVE set. Note the idea for later; do not build it now.
- Any change to `PgAddressRepository`/`runDuplicateAnalysis`'s existing read-only transaction.
- Commit.

### Required tests (by name)
Extend `pgliteHarness.ts` (already has `addresses_master`/`address`/`internal_address_access_point` from Brief 7) with whatever `access_point`/`compact_address`/`territorial_unit_access_point`/`comments_address`/`plural_entity_access_point` minimal tables are needed to exercise the full delete chain.

- `simulateRemoval` returns a fingerprint and a target set containing only `decision = REMOVE` rows — a fixture with a `HAS_INTERNAL_UNITS` row in the mix must prove it is absent from the plan.
- `executeRemoval` with a correct fingerprint deletes exactly the planned rows from all 7 tables, in one transaction, and writes the audit row.
- `executeRemoval` throws and makes **zero** writes when the fingerprint doesn't match (simulate a drift: insert another address between simulate and execute in the test).
- `executeRemoval` is a no-op (returns the stored result, doesn't re-delete or error) on a replayed `operationId` with identical params, and throws on a replayed `operationId` with different params.
- `executeRemoval` throws before touching anything when `comments_address` or `plural_entity_access_point` has any row.
- A row forced to `HAS_INTERNAL_UNITS` is never deletable through `executeRemoval` even if its urn is somehow included in a hand-crafted request — the scope check must be server-side, not trust the caller.
- e2e: the confirm dialog's two-step flow (simulate → review → execute), with the API mocked.

### Definition of done
Full gauntlet, real output pasted:
```
npm run modules:routes:check
npm run lint
npm test
npm run build
npm run doctor
npm run test:e2e
```
No gate weakened. Update `docs/tools/ADDRESS_DEDUP_MODULE.md` describing the new write path, its safety mechanics, and the explicit internal-units exclusion. Report appended to `.agents/handoff/TO_ORCHESTRATOR.md` as "Brief 9 report" — be explicit and exhaustive about what the review scope check actually enforces and how you tested it; this is the one place in this module where "I'm fairly confident" is not good enough.

Do not commit.


---

## Brief 9 — orchestrator addendum (binding, overrides Brief 9 where they differ)

User confirmed the build (2026-10-05). Branch `feat/address-dedup-removal-execution` is cut from the tip of `feat/address-dedup-kpi-drilldown` (not main).

1. **Reference.** The real `carto.baja_direccion` / `baja_direccion_base_v1` definitions were read from the dev DB and saved at
   `C:\Users\g611045\AppData\Local\Temp\claude\c--Alekos-Projects-gis-tools\947681d9-9c0b-4b39-8f12-44d3961eae71\scratchpad\baja_direccion_reference.md`. Read it fully. Brief 9's step list is a summary; the reference has more guards.
2. **Port the per-target integrity guards, not just the lock/delete order.** For the whole target set (doors only, no internals), simulate AND execute must check: every target resolves to exactly one address+master+non-blank URN; URN not ambiguous; master not shared with another address; no other master with the same URN; type is a door (access_point row, no internal_address row); the door has NO `internal_address_access_point` rows (such a row = HAS_INTERNAL_UNITS = out of scope: block it); and the dynamic scan: no other `carto` table with a column named `id_address_master`/`address_master_id`/`addresses_master_id` references a target master (lock them SHARE ROW EXCLUSIVE inside the execute transaction). Decision: `simulateRemoval` returns these as `blockers` (urn + reason list) and `executeRemoval` refuses (throws, zero writes) while any blocker exists. Do not silently skip blocked rows; do not delete the unblocked remainder.
3. **Snapshot/fingerprint** per the reference snapshot shape (address, master, puerta, interna per id, plus territorios and compactas), `md5` of its canonical text, computed in SQL like the reference.
4. **Transaction settings for execute:** `READ COMMITTED`, `SET LOCAL lock_timeout = '5s'`, advisory xact lock on the operation id (`pg_advisory_xact_lock(hashtext('carto.address-dedup.removal'), hashtext(operationId))`) before the idempotency lookup. Audit insert in the same transaction.
5. **Ground rules.** Never run anything against any real database (dev/preprod/prod); build and verify with pglite only. The write path must be unreachable unless `executeRemoval` is called with a fingerprint that equals a freshly recomputed one. Server-side scope: the execute handler must ignore any client-supplied urn list entirely (the request carries connection, province, operationId, responsable, motivo, expectedFingerprint only). Do not commit.
6. **Tell me plainly** in the report: every guard from the reference you did NOT port and why; the final audit-table DDL; and anything pglite cannot faithfully model (locks, advisory locks, READ COMMITTED, dynamic catalog scan) so the reviewer knows what is untested.


---

## Brief 9 — Fix round 1 (branch `feat/address-dedup-removal-execution`, uncommitted, do NOT commit)

Source: code-reviewer verdict APPROVE WITH COMMENTS on Brief 9; user chose to do the fix round WITH the URN list. Same rules as Brief 9 + its addendum. pglite only; never touch any real database. Read-only analysis path stays untouched.

### Changes (all required)
1. **Ids as strings (reviewer F3).** In `services/queries/removalPlanQuery.ts` (~lines 129-131) emit `address_ids` and `master_ids` as `to_jsonb(...::text[])` so they reach JS as strings; keep `mapRemovalRow.ts` consistent. Bind them with the existing `::bigint[]` casts. Add a test with an id above 2^53 (e.g. 9007199254740993) proving it round-trips exactly and the delete removes that exact row. Correct the line in the Brief 9 report that claims ids are kept as strings (append a correction note under "Fix round 1 report", do not rewrite history).
2. **Protected-source tests (F1).** In `pgRemovalRepository.test.ts` add pglite cases: (a) group IDE + ANTEL + TLK, toggle false → the IDE row and the lowest-urn removable row are absent from the plan and survive execute; (b) same group, `protectedSiblingRemovesLone: true` → only ANTEL/TLK rows are targets, IDE survives execute; (c) a `KEPT_ALONGSIDE_PROTECTED` row never appears in the snapshot or targets. Assert on surviving table rows, not only on the plan.
3. **Audit-table shape (F2).** Add a test where `carto.cgeo_2192_baja_masiva_operacion` already exists with a different (e.g. dev-style `baja_direccion_operacion`-like, no `parametros`/`snapshot`) shape: execute must throw and make ZERO deletes (all seven tables unchanged). Additionally make the failure a clean, classified refusal: before any lock or delete, in execute (and in simulate if cheap), verify the audit table, when it exists, has the columns this code needs (`operacion`, `huella`, `responsable`, `motivo`, `parametros`, `ejecutor_bd`, `resultado`, `snapshot`, `created_at`) via `information_schema.columns`; if columns are missing throw `RemovalRefusedError` with a Spanish message naming the missing columns ("La tabla de auditoria carto.cgeo_2192_baja_masiva_operacion existe con otra estructura; faltan columnas: ..."), HTTP 409. Test it.
4. **Length caps (NIT).** `responsable` max 120 chars, `motivo` max 1000, validated in `removalHandlers.ts` (400, Spanish message), constants in `removalConstants.ts`, mirrored in the dialog inputs (maxLength + visible counter not required). Tests for boundary (max ok, max+1 rejected).
5. **Infra-match tables window (F4).** Do NOT add locks. Document the accepted window in `docs/tools/ADDRESS_DEDUP_MODULE.md` section "Removal (the write path)" in a short "Known limits" list (infra-match tables not locked; pglite cannot model locks; no Solr/MV refresh).
6. **List of URNs to delete (user request).**
   - `simulateRemoval` returns, in addition to counts/fingerprint/blockers, the sorted list of target URNs with their fuente (`targets: Array<{ urn: string; fuente: string }>`), derived from the SAME plan statement/scope CTE that produces the fingerprint (not a second query). Add it to the types, mapper, API response and `dedupClient`. It must not be accepted back by `execute` (execute still ignores any client address list; the existing test asserting the execute body carries no address list stays green).
   - UI (`DedupRemovalPlanView.tsx` / dialog): show the list in the review step (scrollable, monospace, virtualised or capped-render is NOT needed up to a few thousand rows but must not freeze: render in a single `<textarea readonly>` or a plain `<pre>` block, not thousands of React nodes), with a count header, and two actions: "Copiar URN" (clipboard, newline-separated) and "Descargar CSV" (`urn,fuente`, client-side blob; file name `address-dedup-removal-plan-<provinceId>-<fingerprint first 8>.csv`; revoke the blob URL after the click like the module's existing export does). Execute stays disabled until the review step is shown, as today.
   - Tests: unit for the plan's `targets` (only REMOVE rows, sorted, equals the set whose count the fingerprint covers; HAS_INTERNAL_UNITS/IDE urns absent); unit for the CSV builder (pure function in `domain/`, quoting, header, newline) ; e2e extend `address-dedup-removal.spec.ts`: list visible in review step, count matches total, copy and download buttons present, download content matches.
   - Docs: document the list in section 6.

### Out of scope
Locking infra tables; selective execution; any change to the read-only analysis path; commit.

### Definition of done
Full gauntlet (routes check, lint, npm test, build, doctor, e2e) green with real output pasted; no assertion weakened. Append "Brief 9 fix round 1 report" to `.agents/handoff/TO_ORCHESTRATOR.md`, stating plainly anything unverified.


---

## Brief 9 — Fix round 2: use the existing dev audit table `carto.baja_direccion_operacion`, never create one (branch `feat/address-dedup-removal-execution`, uncommitted, do NOT commit)

User decision (2026-10-05): the app has NO write/DDL permission in prod, and the dev DB already has the deletion function `carto.baja_direccion` with its own audit table. The removal must write its audit row to THAT table, `carto.baja_direccion_operacion`. This REPLACES the `carto.cgeo_2192_baja_masiva_operacion` table and the lazy `CREATE TABLE` from Brief 9 / fix round 1. Same rules as before: pglite only, never touch any real database, read-only analysis path untouched.

### Real shape (read from dev via pg-dev, 2026-10-05)
```
carto.baja_direccion_operacion (
  operacion        uuid        NOT NULL PRIMARY KEY,
  referencia       text        NOT NULL,
  incluir_internas boolean     NOT NULL,
  huella           text        NOT NULL,
  responsable      text        NOT NULL,
  motivo           text        NOT NULL,
  ejecutor_bd      text        NOT NULL,
  creado_en        timestamptz NOT NULL DEFAULT clock_timestamp(),
  resultado        jsonb       NOT NULL
)
```
`carto.baja_direccion` inserts `(operacion, referencia, incluir_internas, huella, responsable, motivo, ejecutor_bd, resultado) VALUES (..., current_user, resultado)` and, on replay, compares referencia / incluir_internas / huella / responsable / motivo (identical -> return stored `resultado || {recuperada: true}`; else 'El UUID ya fue utilizado con otros parametros.'). Mirror exactly that.

### Changes
1. `removalConstants.ts`: `AUDIT_TABLE = "carto.baja_direccion_operacion"`; `AUDIT_REQUIRED_COLUMNS` = the 9 columns above (no `parametros`, no `snapshot`, no `created_at`). Delete every trace of the old table name and of the DDL (`CREATE_AUDIT_TABLE_SQL`, lazy create). The app must NEVER issue DDL.
2. `services/queries/removalAudit.ts`:
   - Insert exactly the 8 columns the DB function inserts (`creado_en` takes its default). `ejecutor_bd` = `current_user`. `incluir_internas` = false (we never include internals). `referencia` = a deterministic scope string built by one pure function in `domain/removal.ts`, e.g. `address-dedup:province=<id>;protectedSiblingRemovesLone=<bool>` (no free text).
   - `resultado` jsonb must carry what the old `snapshot`/`parametros` columns carried for audit value: counts (total, byFuente, rowsByTable), the fingerprint, the sorted target URN list with fuente, the deleted counts, provinceId, protectedSiblingRemovesLone, and the pending-steps reminder (Solr / materialized views). The snapshot itself is NOT stored (too large and not a column); the fingerprint plus the URN list is the record.
   - Replay lookup compares referencia, incluir_internas, huella, responsable, motivo; stored result returned with `recovered: true`.
3. **Pre-checks, before any lock or delete, in execute (and before the plan in simulate):** the table must exist (if not: `RemovalRefusedError`, Spanish, "La tabla de auditoria carto.baja_direccion_operacion no existe en esta base. Debe crearla un administrador antes de ejecutar bajas."), have the 9 required columns (clear missing-columns message, as already built), and the connected role must have `SELECT` and `INSERT` on it (`has_table_privilege(current_user, 'carto.baja_direccion_operacion', 'SELECT')` and `'INSERT'`; Spanish refusal naming the missing privilege). Also check `has_table_privilege(current_user, ..., 'DELETE')` on the 7 deletion tables and refuse early with a clear message listing the tables lacking DELETE. All of these are HTTP 409 refusals with zero writes.
4. Tests (pglite harness must now create `carto.baja_direccion_operacion` with the real shape above instead of the old table; privilege checks can be tested with a fake `Queryable` asserting the statements, plus pglite where roles are feasible — state what pglite cannot model):
   - existing replay/idempotency/rollback tests re-pointed at the new table and still green;
   - audit row has exactly the expected column values (referencia string, incluir_internas false, ejecutor_bd, resultado containing fingerprint, counts and URN list);
   - missing table -> execute and simulate refuse, zero writes, no CREATE statement ever issued (assert no statement matches /CREATE/i);
   - table with missing columns -> refusal naming them;
   - missing INSERT privilege -> refusal before any lock/delete; missing DELETE privilege on a deletion table -> refusal before any lock/delete;
   - replay with different responsable/motivo/huella/referencia -> refused.
   - e2e/mocks: update any text mentioning the old table or "se crea la tabla".
5. `docs/tools/ADDRESS_DEDUP_MODULE.md` section 6: document the new audit table, that it exists today only in dev and must be created in prod by an administrator before the first real run (state this as a prerequisite, with the DDL shape above), the privilege pre-checks, and what `resultado` contains. Remove the "shared with the CGEO-2192 script" language. Update the Brief 9 notes accordingly. Do NOT edit the CGEO-2192 files (outside the repo).

### Out of scope
Creating the table anywhere, any DDL in app code, storing the snapshot in the DB, commit.

### Definition of done
Full gauntlet green with real output pasted, no assertion weakened (re-pointing a test at the new table is fine; say so). Append "Brief 9 fix round 2 report" to `.agents/handoff/TO_ORCHESTRATOR.md`, stating plainly what is unverified.


---

## Brief 10 — Removal simulate is too slow: remove the per-target full scan of carto.address (branch `fix/address-dedup-removal-simulate-speed`, cut from `main`, do NOT commit)

Binding rules: `AGENTS.md`, `.agents/rules/*.md`. npm via `C:\Alekos\Tools\node24portable`. pglite only; never touch any real database. Read-only analysis path untouched. Semantics of the removal plan must NOT change (same targets, same blockers, same fingerprint for the same data).

### Diagnosis (orchestrator, measured on the DEV database via EXPLAIN ANALYZE, 2026-10-05)
User: "the simulation of deletion takes way too long, can we do it by batches?"
`carto.address` (~977k rows) has NO index on `id_address_master` (indexes: `id` pk/idx, a gist on geometry). In `services/queries/removalPlanQuery.ts` the `verdicts` CTE computes `master_shared` with a correlated `EXISTS (SELECT 1 FROM carto.address other WHERE other.id_address_master = r.master_id AND other.id <> r.address_id)` inside `bool_or(...)`. Postgres runs it as a SubPlan: one FULL SEQ SCAN of carto.address PER resolved row. Measured: 100 targets = `SubPlan 1 Seq Scan on address other (loops=100)`, 2.4M buffer hits, 10.3 s. The real target set is ~1,400+ rows => roughly 140 s, i.e. near the 180 s statement timeout. (The other correlated EXISTS in `verdicts` hit `access_point` (pk indexed) and the two ~3.8k-row unindexed internal tables: negligible.) Batching would NOT fix this (the cost is per target, and the analysis part would be recomputed per batch, and execute would lose all-or-nothing atomicity); do not introduce batching.

### Change (required)
1. In `removalPlanQuery.ts` compute `master_shared` set-based from the data `resolved` ALREADY holds: `resolved` joins each target urn -> master -> ALL address rows of that master (`LEFT JOIN carto.address a ON a.id_address_master = m.addresses_master_id`), so a master is shared with another address iff it has more than one distinct `address_id` in `resolved`. Add a CTE such as `master_address_counts AS (SELECT master_id, count(DISTINCT address_id) AS n FROM resolved WHERE master_id IS NOT NULL GROUP BY master_id)` and derive `master_shared` per urn from it (`bool_or(mac.n > 1)` via a join), with NO subquery against `carto.address` anywhere in `verdicts`. Behaviour must be identical to the old predicate (any other address row for the same master => shared).
2. Check the rest of the file and `resolveRemovalPlan.ts` for any other per-row subplan or per-row query against `carto.address`, `carto.addresses_master` or other large tables and remove it the same way (set-based, one pass). The master-reference scan (`scanMasterReferences`) already runs one query per referencing table; keep it, but you may drop the `::text` cast on the column side ONLY if you can bind a typed array safely (the column types are `integer`; ids are strings in JS for bigint safety: cast the parameter side to the column's type instead, e.g. `col = ANY($1::bigint[])`, so an index on a column (e.g. carto.territorial_unit, carto.addresses_2_0_edit) can be used). Preserve exact results.
3. The same plan SQL is used by simulate and execute (shared function): verify nothing else differs.

### Tests
- Existing pglite tests for the master-shared blocker must still pass unchanged. Add: a master with two address rows (target door + sibling) is blocked MASTER_SHARED; a master with one address is not; two targets sharing one master are both flagged. Plan, blockers and fingerprint for a fixed fixture must be byte-identical to before (capture the expected fingerprint from the current implementation in a test fixture BEFORE changing the SQL, then assert it after).
- Add a structural test asserting the plan SQL contains no correlated subquery of `carto.address` (e.g. no `FROM carto.address other`) so the regression cannot return silently.

### Out of scope
Batching; adding indexes (no DDL, and the user has no write rights in prod); changing analysis query; commit.

### Definition of done
Full gauntlet (routes check, lint, unit, build, doctor, e2e) green, real output pasted. Append "Brief 10 report" to `.agents/handoff/TO_ORCHESTRATOR.md`, stating plainly what you could not measure (no real DB).


---

## Brief 11 — closing the removal success summary re-runs the analysis (branch `feat/address-dedup-reload-after-removal`, cut from `main`)

Binding rules: `AGENTS.md`, `.agents/rules/*.md` (coding_guidelines, testing_standards, module_authoring). npm via `C:\Alekos\Tools\node24portable`.

### Goal
After a successful execution, the data on screen is stale — it still reflects the pre-deletion analysis. User-requested: when the removal dialog's success summary (`RemovalPhase.DONE`, showing `DedupRemovalResultView`) is closed, automatically re-run the analysis so the dashboard reflects the post-deletion state, instead of requiring a manual "Volver a analizar" click.

### Decision (orchestrator, binding)

**Reuse the existing re-run path, do not build a new one.** `DedupDashboard.tsx` already has `runAnalysis(resultPayload)` wired to `DedupContextBar`'s rerun button — that is the exact same operation this needs, not a new analysis call. The fix is wiring an existing function to a new trigger, nothing more.

**Only trigger on close from `RemovalPhase.DONE`.** Closing the dialog from `FORM`, `REVIEW`, or after an error must **not** re-run anything — nothing changed in those cases, and re-analyzing would just be a wasted query against a possibly-slow production connection (see Brief 10's own diagnosis of how slow the removal plan query can be before its fix lands — one more reason not to fire it needlessly). The reducer in `domain/removalFlow.ts` already models this precisely: `DONE` is the one phase that only exists after `EXECUTE_SUCCESS`.

### Change

Thread one new callback down the existing prop chain — do not lift `useDedupRemoval`'s state up, do not restructure the dialog:

1. **`ui/DedupDashboard.tsx`**: pass a new prop to `DedupResultsView`, e.g. `onRemovalComplete={() => runAnalysis(resultPayload)}` — reuses the function already defined there (around line 66). Guard against `resultPayload` being null the same way the rest of this component already does.
2. **`ui/DedupResultsView.tsx`**: accept `onRemovalComplete: () => void`, forward to `DedupSummaryTab`.
3. **`ui/DedupSummaryTab.tsx`**: accept it, forward to `DedupRemovalPanel`.
4. **`ui/DedupRemovalPanel.tsx`**: accept it. Wrap the close path: when the dialog closes and `flow.state.phase === RemovalPhase.DONE` at the moment of closing, call `flow.close()` **and then** `onRemovalComplete()`; for any other phase, call `flow.close()` only. Do not change `useDedupRemoval.ts`'s `close` itself or the reducer — this decision belongs at the call site that already knows about both the flow and the dashboard's re-run function, not inside the pure reducer.

Expected (and desired) side effect, not something to fix: `DedupResultsView` is mounted with `key={analysis.resultId}` in `DedupDashboard`, so once the re-run's new data lands, it remounts fresh — back on the Resumen tab, Grupos filters cleared. That's the right behavior (the old filtered view pointed at now-deleted rows would be misleading) — don't try to preserve the prior tab/filter state across this reload.

### Out of scope
- Any change to `removalFlow.ts`'s reducer, `useDedupRemoval.ts`, or the dialog's own phases.
- Auto-closing the dialog itself, or changing what it displays — only what happens *after* the user closes it.
- Exporting a "before" geojson automatically before execute (raised separately by the user after discovering no before/after snapshot existed for a dev run; not part of this brief — tell us if you want that written up too).
- Anything from Brief 10 (the simulate-speed fix) — independent branches, independent concerns.
- Commit.

### Required tests
- e2e (`tests/e2e/flows/address-dedup.spec.ts` or a removal-specific spec): simulate → execute (mocked success) → close the summary → assert a new `analyze` request fires with the same connection/parameters, and the dashboard returns to the Resumen tab on the fresh result.
- A case closing from the `REVIEW` phase (cancel before executing) or from an error state asserts **no** extra `analyze` request fires.
- Unit test if `DedupRemovalPanel`'s close-wrapping logic is extracted to a plain function — otherwise the e2e case above is sufficient (no new pure `domain/` logic is introduced here).

### Definition of done
Full gauntlet, real output pasted:
```
npm run modules:routes:check
npm run lint
npm test
npm run build
npm run doctor
npm run test:e2e
```
No gate weakened. Report appended to `.agents/handoff/TO_ORCHESTRATOR.md` as "Brief 11 report".

Do not commit.


---

## Brief 12 — Fix: restore the type-agnostic master-reference scan (regression from Brief 10) (branch `fix/address-dedup-master-scan-text-cast`, cut from `main`, do NOT commit)

Binding rules: `AGENTS.md`, `.agents/rules/*.md`. npm via `C:\Alekos\Tools\node24portable`. pglite only; never touch any real database; no DDL.

### Problem (found in independent review of Brief 10, confirmed by reading the SQL)
In `services/queries/resolveRemovalPlan.ts`, Brief 10 changed `findReferencedMasters` from `col::text = ANY($1::text[])` to `col = ANY($1::bigint[])`. `LIST_MASTER_REFERENCES_SQL` selects the tables to scan by COLUMN NAME only (`id_address_master`, `address_master_id`, `addresses_master_id`), never by type. If any `carto` table has such a column typed `text` (or anything not castable from bigint), the bigint comparison raises an error and the whole master-reference scan, hence simulate and execute, crashes. It fails safe (crash before any DELETE), but it is a regression against the stated condition for the change ("only if the column types are safe"). On the current dev DB every such column is `integer`, so it does not bite today; the point is not to depend on that. The per-table scan was never the real bottleneck of Brief 10 (the correlated `carto.address` subplan was), so reverting costs no speed.

### Change
1. Revert `findReferencedMasters` to the type-agnostic form: `SELECT DISTINCT <col>::text AS master_id FROM <table> WHERE <col>::text = ANY($1::text[])` with the ids bound as `text[]` (as before Brief 10). Keep everything else from Brief 10 (the set-based `master_shared`, the structural test, the fingerprint fixture) untouched.
2. Tests (pglite): add a fixture table in `carto` with a TEXT-typed reference column (e.g. `carto.legacy_refs (addresses_master_id text)`, and one more with an integer-typed one) and prove: (a) the scan does not throw with a text-typed column present; (b) a target master referenced from the text column is reported as a blocker `master used by carto.legacy_refs (...)`; (c) a master not referenced is not blocked; (d) the integer-typed table still works. Also assert the statement text in the scan contains `::text = ANY($1::text[])`, so an accidental re-introduction of the bigint comparison fails a test. Keep the Brief 10 tests green unchanged.
3. Update `docs/tools/ADDRESS_DEDUP_MODULE.md` only if it mentions the bigint comparison; otherwise no docs change.

### Out of scope
Any other change to the plan SQL, batching, indexes, commit.

### Definition of done
Full gauntlet (routes check, lint, unit, build, doctor, e2e) green, real output pasted. Append "Brief 12 report" to `.agents/handoff/TO_ORCHESTRATOR.md`.
