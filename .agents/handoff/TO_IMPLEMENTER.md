# Implementation plan — edit a watched source

> The previous mission (remove the status module) is complete and committed on `main` as `5d9e24a`.

**Branch**: `feat/watcher-edit-source`, cut from `main`.

## Why

A watched source is identified by the dataset reference the user pasted. When a portal moves a
dataset to a new slug, the only recovery today is *delete and re-add* — and for the two shipped
defaults not even that, because `removeSource` refuses them. Those two are precisely the datasets
this tool exists to track, so a slug change bricks them permanently.

Deleting and re-adding also orphans the vault: files live under `data/vault/<datasetSlug>/`, so the
new entry starts with an empty cache and re-downloads everything.

## Goal

When this is done:

1. Every card — **including the two shipped defaults** — offers "Editar" and accepts a new portal
   URL or bare slug.
2. The source keeps its identity across the edit: same `id`, same position, same card.
3. The portal is consulted before the change is persisted, and `title`/`description` are refreshed
   from what it publishes.
4. Downloaded files follow the source to its new slug instead of being orphaned.
5. An edit that would collide with another watched source is refused with a readable Spanish message.

## Binding decisions (already made — do not revisit)

**D1 — `id` is an immutable opaque handle.** It is still *seeded* from `sanitizeSlug(datasetSlug)` at
creation, but it is never recomputed. An edit mutates `datasetSlug`/`portalHost`/`title`/
`description` and leaves `id` alone. No migration, no change to `addSource`.

**D2 — only the portal reference is user-editable.** `title` and `description` are re-derived from
the CKAN package on save, exactly as `addSource` does. Do not add a manual title field.

**D3 — `isDefault` is derived on load, never trusted from disk.** `sources.json` stays a flat array.
`loadSources` partitions it by whether each `id` matches a `DEFAULT_WATCHED_SOURCES` entry: matches
are *overrides* applied over the shipped default (with `isDefault: true` re-stamped), the rest are
custom sources. This is what makes a default editable while still un-removable. Existing files load
unchanged.

**D4 — an edit may not collide.** If the resulting `portalHost` + `datasetSlug` already belongs to a
*different* `id`, refuse. `addSource` keeps its current collapse-by-id behaviour; do not touch it.

**D5 — the vault follows the slug, and nothing is ever deleted.** On a slug change, rename
`data/vault/<oldSlug>` to `data/vault/<newSlug>` **only when the destination does not exist**. If it
does exist, leave both directories untouched. This is safe because `evaluateResourceDelta` compares
against the portal on every read, so a carried-over sidecar can never serve a stale file — the worst
case is one re-download.

**D6 — per-card pending state.** The dashboard currently passes `isRemoving: boolean`, which greys
out *every* card during any removal. Replace it with `pendingSourceId: string | null`; the card
compares it to `source.id`.

## Explicitly out of scope

- **"Restore original" for an edited default.** Not needed: the original URL stays visible on the
  card via "Ver en el portal", and a second edit restores it. Do not add a `sources/restore`
  endpoint.
- Editing `title` or `description` by hand (D2).
- Changing `addSource`, `removeSource`, or the id-seeding rule.
- Deleting or merging orphaned vault directories (D5).
- Any change to the catalogue tree, the sync tools, or `CatalogTreeSelector`.

## Work, in order

### 1. `services/WatchedSourcesStorageService.ts`

- Rewrite `loadSources` per **D3**: partition persisted rows by default-id membership, apply
  overrides over `DEFAULT_WATCHED_SOURCES`, re-stamp `isDefault`. Keep the existing behaviour that a
  missing or corrupt file yields the plain defaults.
- `persist` writes overrides **and** custom rows (everything that is not an untouched default).
- New `updateSource(sourceId, changes): Promise<WatchedSource[]>` — replaces the matching row,
  preserving `id`. Throws a Spanish error when `sourceId` matches nothing.
- `removeSource` keeps refusing defaults, unchanged.

### 2. `services/VaultStorageService.ts`

- New `renameSourceDir(oldSlug, newSlug): Promise<boolean>` — returns `false` without touching disk
  when the source directory is absent or the destination already exists; renames and returns `true`
  otherwise. Both slugs go through `sanitizeSlug`, same as every other path in the class.

### 3. `services/WatcherOrchestrator.ts`

- New `updateSource(sourceId, rawInput): Promise<WatchedSource[]>`:
  1. `parsePortalReference(rawInput)`.
  2. Load sources; find `sourceId` or throw.
  3. Enforce **D4** against the other rows.
  4. `portal.fetchPackage(...)` — a reference that does not resolve is never persisted.
  5. When the slug changed, `vault.renameSourceDir(oldSlug, newSlug)`.
  6. `sourcesStorage.updateSource(...)` with the refreshed `title` (`ckanPackage.title ||
     formatTitleFromSlug(slug)`) and `description` (`ckanPackage.notes`).

### 4. Route + wiring

- `module.routes.json`: add `{ "path": "sources/update", "method": "POST", "runtime": "nodejs",
  "dynamic": "force-dynamic" }`.
- `manifest.ts`: bind `"POST sources/update"` to `handlers.updateSource`.
- `api/handlers.ts`: `updateSource` handler on the `removeSource` pattern — reject a blank
  `sourceId` or blank `url` with 400 and a Spanish message; otherwise delegate and return
  `{ success: true, sources }`.
- **Regenerate routes with `npm run modules:routes`. Never hand-write anything under `src/app/`.**

### 5. `ui/watcherClient.ts`

- `updateSource(sourceId, url)` mirroring `removeSource`.

### 6. UI

- `WatchedSourceCard.tsx`: local `isEditing` state. Footer gains an "Editar" button (lucide
  `Pencil`) shown for **all** sources, defaults included, placed between "Ver en el portal" and
  "Dejar de vigilar". While editing, the metrics block is replaced by a form: a text input prefilled
  with `https://${source.portalHost}/dataset/${source.datasetSlug}`, plus "Guardar" and "Cancelar".
  New props: `isPending: boolean`, `onUpdate: (sourceId, url) => void`.
- `WatchedSourceCard.module.css`: styles for the edit form and the new button. **Modular CSS only —
  no inline styles** (`.agents/rules/coding_guidelines.md`).
- `WatcherDashboard.tsx`: `updateSourceMutation` invalidating both query keys on success; fold its
  error into the existing `mutationError` chain; implement **D6** by deriving `pendingSourceId` from
  whichever mutation is in flight and passing `isPending={pendingSourceId === source.id}`.

### 7. Tests — `tests/unit/modules/cartography-watcher/`

AAA, Spanish-facing assertions on messages, per `.agents/rules/testing_standards.md`.

`watcherOrchestration.test.ts`:
- should keep the source id when its portal reference changes
- should refresh the title from the portal when a source is edited
- should refuse an edit whose reference the portal cannot resolve, leaving the stored row untouched
- should refuse an edit that collides with another watched source
- should refuse an edit naming a source that is not watched
- should persist an edit to a shipped default while still refusing to remove it
- should carry the vault directory over when the dataset slug changes
- should leave both directories alone when the destination vault directory already exists
- handlers: should reject an update with no `sourceId`; should reject an update with no `url`

`vaultServices.test.ts`: direct coverage of `renameSourceDir` — renames, refuses an existing
destination, no-ops on a missing source directory.

`cartographyWatcherManifest.test.ts`: add `[ModuleHttpMethod.POST, "cartography-watcher/sources/update"]`
to `expectedRoutes`.

### 8. Docs

`docs/tools/CARTOGRAPHY_WATCHER_MODULE.md`: document the edit flow, the immutable-id rule (D1), the
default-override mechanism (D3) and the vault-follows-slug rule (D5).

## Definition of done

The full gauntlet green on `feat/watcher-edit-source`, with real output pasted in the report:

```
npm run modules:routes:check
npm run lint
npm test
npm run build
npm run doctor
```

`modules:routes:check` must pass **after** `modules:routes` has been run and the generated
`src/app/api/m/cartography-watcher/sources/update/route.ts` committed.

No test weakened, skipped or deleted. Do not commit — version control is a separate, explicitly
authorised step.

## Rules that bind this work

`AGENTS.md`, `.agents/rules/coding_guidelines.md`, `.agents/rules/module_authoring.md`,
`.agents/rules/testing_standards.md`.

---

# Fix round 1 — review findings

Round 1 of 3. The gauntlet was re-run by the orchestrator and is **green on all five gates**
(routes:check, lint, 299 tests, build, doctor 100/100). Nothing below is a gauntlet failure; these
are review findings. Note `npm` is not on PATH — prepend `C:\Alekos\Tools\node24portable` per
`.agents/rules/portable_node.md`.

Fix these in order. Do not touch anything not listed. Do not commit.

## F1 [BLOCKER] — the generated route is untracked

`src/app/api/m/cartography-watcher/sources/update/` is `??` in `git status` while all 15 other
changed files are `M`. `git add -u` would skip it and ship a declared-but-missing endpoint: every
"Guardar" would 404 into the generic "No se pudo actualizar la fuente" banner, and
`modules:routes:check` cannot catch it because it reads the working tree.

Stage it explicitly: `git add src/app/api/m/cartography-watcher/sources/update/`. Do not hand-edit
the file — it is generator output.

## F2 [MAJOR] — `addSource` silently reverts an edited default

`WatcherOrchestrator.addSource` still derives `id = sanitizeSlug(datasetSlug)` and
`WatchedSourcesStorageService.addSource` drops any row with that id. Under D3 a row whose id matches
a default *is* that default's override, so:

> Default #1 is edited to `padron-rural`. The user later pastes the original
> `.../dataset/ide-ejes-vias-circulacion` into "Agregar una fuente". The derived id equals default
> #1's id, the override row is filtered out and replaced — **the `padron-rural` edit disappears, no
> third source is added, `data/vault/padron-rural` is orphaned, and the API answers
> `success: true`.**

Variant: adding `padron-rural` after that edit yields id `padron-rural` != the default's id, so two
watched sources share a `portalHost` + `datasetSlug` and one vault directory — what D4 forbids.

Apply D4 to `WatcherOrchestrator.addSource`: refuse when the resolved `portalHost` + `datasetSlug`
already belongs to any watched source, and refuse when the derived id collides with an existing
source id. Spanish messages, consistent with the ones `updateSource` already throws. Cover the
edit-default then add then `loadSources` sequence with a storage-level test.

## F3 [MAJOR] — the vault rename is uncompensated and its failure is discarded

`renameSourceDir` swallows every error and returns `false`; `WatcherOrchestrator.updateSource`
ignores the return value and runs the rename *before* persisting. On Windows `fs.rename` on a
directory throws `EPERM`/`EBUSY` whenever a file inside is open (antivirus, an open CSV), so this is
routine, not exotic. Either failure order desynchronises `sources.json` from the vault and forces a
full re-download; worse, a retry is then refused by the destination-exists branch, making the new
directory an unreachable orphan.

**Do not fix this by reordering** — persist-then-rename has the same window in mirror image. Fix it
by making the outcome legible and failing closed:

- `renameSourceDir` returns a discriminated result distinguishing *renamed*, *nothing to move*
  (source directory absent), *destination occupied*, and *failed*. Keep D5: never delete.
- `updateSource` aborts with a Spanish error **before persisting** when the result is *failed*, so a
  rejected edit leaves disk and catalogue both untouched. *Nothing to move* and *destination
  occupied* proceed as they do today.
- Test the *failed* branch by pointing the vault at a path that cannot be renamed.

## F4 [MAJOR] — a rejected edit closes the form and eats the typed URL

`handleSave` calls `onUpdate(...)` then `setIsEditing(false)` in the same batch, treating the
mutation as fire-and-forget. On a rejection (mistyped slug, portal down, D4 collision) the card has
already collapsed to read-only showing the *old* values, and the only feedback is the page-level
banner rendered inside the **"Agregar una fuente"** panel at the top of the page, where it reads as
if the add form failed. Reopening the editor runs `setEditUrl(portalUrl)` and the typed text is
gone. The `disabled={isPending}` props on the input and both buttons are dead code — the form is
never mounted while the mutation is in flight.

Keep the form open until the mutation settles; close it only on success; render the error **inside
the card** so the typed value survives a rejection. This also resolves the stale-error precedence in
`WatcherDashboard.tsx` (`addSourceMutation.error ?? ...` keeps showing a previous *add* failure while
an *edit* fails), since the edit error stops going through the shared banner.

## F5 [MAJOR] — an edited default keeps the old dataset's description

`updateSource` writes `description: ckanPackage.notes`. When CKAN publishes no `notes` the key is
`undefined`, `JSON.stringify` drops it, and on reload `{ ...defaultSource, ...override }` falls back
to the **shipped** description. A default repointed at a notes-less dataset renders the new title
above the old dataset's Spanish blurb, permanently.

`WatchedSource.description` is `readonly description?: string` — **`?? null` is a type error**. Use
`?? ""` and let the card's existing `{source.description && ...}` guard hide it. Assert `description`
in "should refresh the title from the portal when a source is edited"; `buildPackage` never sets
`notes`, so add a case that does and one that does not.

## F6 [MINOR] — one bad sidecar skips the rest of the rename rewrite

A single `try/catch` wraps the whole sidecar `for` loop in `renameSourceDir`. One corrupt or locked
`*.meta.json` throws out of the loop, leaving every later sidecar pointing at the old slug while the
method still returns success — `readAllMeta` ignores `relativeFilePath` so the dashboard reports "al
día", but `readResource` then fails and silently re-downloads each one. `readAllMeta` already treats
a corrupt sidecar as skippable, so this is an expected state.

Move the `try/catch` inside the loop.

## F7 [MINOR] — comments narrate, and cite a scratch document

`.agents/rules/coding_guidelines.md` rule 17 and the "Minimal & Critical Comments Only" section of
`AGENTS.md` bind this diff. Remove:

- narration that restates the line above it — `// Destination does not exist; proceed with rename`,
  `// Destination directory already exists; leave both untouched per D5`, `// Non-critical: sidecar
  relative path update failure`
- every `Per D5` / `Per D3` / `(D1)` / `(D4)` label. They point into this file, which is rewritten
  for the next feature.

**Keep one invariant**, restated on its own terms rather than by decision id: carrying a vault
directory across a slug change cannot serve a stale file, because `evaluateResourceDelta` re-checks
the portal on every read — the worst case is one re-download.

## F8 [NIT]

- `WatchedSourceCard.tsx`: `handleStartEditing` does `setIsEditing((current) => !current)` on a
  button permanently labelled "Editar". Make it open, not toggle.
- `VaultStorageService.ts`: stray blank line after the class closing brace.
- `docs/tools/CARTOGRAPHY_WATCHER_MODULE.md`: "without orphan directory accumulation" is wrong —
  the destination-occupied branch is precisely the case that leaves an orphan. Correct the sentence.

## Rejected — do not implement

- **Re-stamping `isDefault: false` on an unknown-id row that claims `isDefault: true`** (instead of
  dropping it). The scenario needs a shipped default's id to be changed or removed, which would
  warrant a migration anyway, and dropping is the safer failure mode than letting a hand-edited file
  shadow a shipped source. The existing test "should ignore persisted entries that claim to be
  defaults" stays exactly as it is.
- **Returning 400 instead of 500 for D4 collisions and "fuente no encontrada".** Real, but
  `addSource` has the same shape; fixing it only on the edit path makes the surface inconsistent.
  Separate change.

## Definition of done

Full gauntlet green again, real output pasted. No test weakened, skipped or deleted — F2, F3 and F5
each add coverage. Do not commit.

---

# Fix round 2 — architectural refactor

Round 2 of 3. **Behaviour-preserving.** Round 1 closed every correctness finding and the gauntlet is
green (verified independently by the orchestrator: routes:check, lint, 305 tests, build, doctor
100/100). Nothing here is a bug. This round is about the *shape* of the change, judged against
`.agents/rules/code_review_standards.md` §2 and the decomposition rules in `AGENTS.md:80-82`.

**Read this first.** The scope of the feature is correct — nothing gets removed. The problem is that
the second use case was pasted rather than factored, so an "edit a source" feature reads far heavier
than it is. Done properly this round should come out **roughly net-neutral or smaller**, not bigger.

## The safety net

The 305 existing tests are the specification. **No assertion may be changed, loosened, renamed or
deleted in this round.** Import paths may change where a symbol moves file. If any refactor below
seems to require altering a test's expectations, **stop and report it in
`.agents/handoff/TO_ORCHESTRATOR.md` instead of changing the test** — it means the refactor is
altering behaviour, which is out of scope for round 2.

Note `npm` is not on PATH — prepend `C:\Alekos\Tools\node24portable` per
`.agents/rules/portable_node.md`.

## R1 [MAJOR] — `WatchedSourceCard` is a God component

`src/modules/cartography-watcher/ui/WatchedSourceCard.tsx` went from 88 to 167 lines and now holds
two reasons to change: *displaying* a watched source (badge, description, metrics, portal link,
remove) and *editing* one (`isEditing` / `editUrl` / `editError`, an async submit handler, inline
error rendering, a two-button action row).

The module already establishes the right pattern: `ui/AddSourceForm.tsx` (45 lines) is a dedicated
form component that the dashboard composes. The edit form was written inline instead, against that
precedent.

Extract `ui/EditSourceForm.tsx` + `ui/EditSourceForm.module.css`, mirroring `AddSourceForm`:

- Props: the current portal URL as the initial value, `isSubmitting`, `onSubmit(url)`, `onCancel`,
  and the error to display (or it owns its own error state — your call, but the card must not).
- Move `editForm` / `editLabel` / `editInput` / `editFormActions` / `saveButton` / `cancelButton`
  out of `WatchedSourceCard.module.css` into the new module CSS. Leave `editButton` and
  `actionsGroup` on the card — they are card chrome, not form.
- `WatchedSourceCard` keeps only `isEditing` (which view to render) and renders `<EditSourceForm>`.
  `editUrl` and `editError` move into the form.

**Do NOT merge `EditSourceForm` with `AddSourceForm`.** I considered it and rejected it: add clears
on submit and has no cancel; edit prefills, has a cancel, and renders a card-local error. Unifying
them needs a mode flag, and a flag argument that switches behaviour is a worse anti-pattern than two
small honest components. The shared surface is one input and one button — too thin to be worth a
coupling.

## R2 [MAJOR] — the collision guard is copy-pasted

`services/WatcherOrchestrator.ts` now carries the same check twice, including the same user-facing
string verbatim at line 63 and line 113:

```
Ya existe una fuente vigilada para el conjunto "${datasetSlug}" en "${portalHost}".
```

`AGENTS.md:82` requires dedicated single-responsibility helpers with the calling method acting as a
high-level orchestrator. Extract one private helper, e.g.:

```
private assertReferenceIsFree(
  sources: ReadonlyArray<WatchedSource>,
  portalHost: string,
  datasetSlug: string,
  exceptSourceId?: string
): void
```

`addSource` calls it with no `exceptSourceId`; `updateSource` passes the id being edited. The
`derivedId` collision check in `addSource` stays where it is — it is genuinely specific to adding.
One definition of the message, one definition of the case-insensitive comparison.

## R3 [MAJOR] — `renameSourceDir` does two jobs

`services/VaultStorageService.ts` — the method is ~55 lines with four nested `try/catch` blocks, in
a class whose other methods are 5-15 lines. It decides the rename outcome *and* rewrites every
sidecar's `relativeFilePath`.

Split it: `renameSourceDir` keeps the four-outcome decision (`SOURCE_ABSENT` / `DESTINATION_EXISTS` /
`FAILED` / `RENAMED`) and delegates the sidecar pass to a private
`rewriteSidecarPaths(destinationDir, newSlug): Promise<void>`. Behaviour is unchanged — a corrupt
sidecar is still skipped, a listing failure is still non-fatal, the method still returns `RENAMED`.

Keep the invariant comment on `renameSourceDir`. It is the one comment in this diff that earns its
place.

## R4 [MAJOR] — domain logic living in a persistence service

`services/WatchedSourcesStorageService.ts` holds two pure domain rules:

- `isUntouchedDefault(source)` — a module-level free function comparing a source against the shipped
  defaults.
- the override merge inside `loadSources` — partition persisted rows by default-id membership, apply
  overrides over `DEFAULT_WATCHED_SOURCES`, re-stamp `isDefault`.

Neither touches the filesystem, and the module has a `domain/` layer (390 lines across four files)
that exists precisely for this. Move both into a new `domain/sourceOverrides.ts` as pure functions —
`mergeOverridesOverDefaults(persistedRows): WatchedSource[]` and `isUntouchedDefault(source)`.

`WatchedSourcesStorageService` is then honestly what its name says: read the file, parse it, hand the
rows to the domain, write back what the domain says to persist. Add direct unit tests for the two
pure functions in a new `tests/unit/modules/cartography-watcher/sourceOverrides.test.ts` — they are
now testable without a temp directory, which is the point of the move.

## R5 [MINOR] — a lying prop contract

`ui/WatchedSourceCard.tsx`: `onUpdate: (sourceId: string, url: string) => Promise<unknown> | void`.
The card `await`s it, so a `void` implementation silently makes the error handling dead — the
`catch` can never fire and the form would close on failure again, reintroducing round 1's F4. The
type permits exactly the bug we just fixed.

Tighten to `Promise<void>`. The dashboard already passes an async function, so no call site changes.
This applies to whichever component owns the submit after R1.

## R6 [MINOR] — `pendingSourceId` derivation is unreadable

`ui/WatcherDashboard.tsx` derives it with a chained ternary-plus-nullish expression mixing two
mutations. The same file already establishes the pattern for this: `indexSummariesBySourceId` and
`sumPendingResources` are module-level helpers above the component. Add a third in the same style,
so the component body stays declarative.

## Out of scope for this round

- Any behaviour change whatsoever. If a refactor changes what the app does, it is wrong.
- Merging `AddSourceForm` and `EditSourceForm` (R1).
- The 400-vs-500 status question and the `isDefault` re-stamping question, both rejected in round 1
  and still rejected.
- The two round-1 NITs I chose not to spend a round on, unless you are already editing that file:
  `renameSpy.mockRestore()` belongs in `afterEach`, and the FAILED-branch test could assert the
  directories stayed put.

## Definition of done

Full gauntlet green, real output pasted into `.agents/handoff/TO_ORCHESTRATOR.md`. **305 tests still
passing, plus whatever `sourceOverrides.test.ts` adds — the count may only go up.** No assertion
altered. Report per finding id (R1-R6), and state plainly anything you did not do and why.

Do not commit.

---

# Fix round 3 — final round

Round 3 of 3, the last the pipeline allows. Round 2's refactor was verified sound: a fresh-context
review traced the override merge, the sidecar rewrite and the collision helper against `main` and
found **no behavioural drift**, no test weakened (the only `-` lines in the whole test diff remain
two `import` statements), no dead CSS, no over-abstraction. The gauntlet is green at 312 tests,
verified independently by the orchestrator.

Six items remain. All are small. Do not touch anything else.

## G1 [MAJOR] — the same Spanish message is thrown from two layers

`services/WatcherOrchestrator.ts:86` and `services/WatchedSourcesStorageService.ts:61` both throw
the byte-identical string:

```
No se encontró la fuente vigilada con identificador "${sourceId}".
```

This is the exact defect class R2 was raised to remove, with one copy left standing. It is not dead
defence: `updateSource` checks existence at orchestrator line 84, then awaits
`portal.fetchPackage` and possibly a vault rename — a multi-second window in which a concurrent
`POST sources/remove` for the same id makes the storage-layer throw fire for real. Only the
orchestrator copy is covered by a test (`watcherOrchestration.test.ts:476`); the storage copy has
none, so the two can silently diverge with the gauntlet still green.

**Keep both throws** — each guards its own public contract. Share the message: add

```ts
export function sourceNotFoundMessage(sourceId: string): string
```

to `domain/sourceOverrides.ts` and call it from both sites. Add a storage-level test that
`updateSource` on an unknown id throws it.

## G2 [MINOR] — an in-flight edit form re-enables when another card is removed

`ui/WatcherDashboard.tsx:42-55`. `resolvePendingSourceId` flattens two independent mutation states
into one nullable id and gives remove unconditional priority:

> User clicks Guardar on card A — the form disables correctly. While that request is in flight the
> user clicks "Dejar de vigilar" on card B. `pendingSourceId` flips to `"B"`, and **card A's form
> re-enables mid-flight**: input editable, Guardar clickable, a second update dispatchable.

The second update is idempotent so nothing corrupts, but the UI lies about in-flight state.

**Delete `resolvePendingSourceId` — this reverses R6, and that is correct.** R6 asked for a helper
to make the derivation readable; the right answer is that the derivation should not exist. Pass the
two states to the card separately:

```
isRemoving={removeSourceMutation.isPending && removeSourceMutation.variables === source.id}
isUpdating={updateSourceMutation.isPending && updateSourceMutation.variables?.sourceId === source.id}
```

The card uses `isRemoving` to disable the remove button and `isUpdating` for the form's
`isSubmitting`. Secondary win: it retires a four-parameter signature interleaved as
`(value, flag, value, flag)`, where swapping the two booleans still compiles.

## G3 [MINOR] — protect the "form must not close on failure" contract

`ui/WatchedSourceCard.tsx:51-54`. Round 1's F4 fix survives only because `await onUpdate(...)`
precedes `setIsEditing(false)`. Reordering those two lines, or wrapping the await in a `try`,
silently reintroduces the bug — the form closes on rejection, the error dies with the unmounted
component, and the gauntlet stays green.

The repo has no component-test infrastructure (30 test files, all `.ts`, no Testing Library), and
introducing it for one contract is not this round's job. Instead make the invariant explicit with a
one-line comment at the call site — this qualifies under the "essential architectural invariant"
carve-out in `AGENTS.md` and rule 17, and is the reason that carve-out exists:

```ts
// Closing only after the await resolves is what keeps a rejected edit on screen.
```

## G4 [MINOR] — dead state resets in `EditSourceForm.handleCancel`

`ui/EditSourceForm.tsx:43-47`. `setEditError(null)` and `setEditUrl(initialUrl)` run immediately
before `onCancel()`, which unmounts the form. The component has no persistent identity — the next
open remounts with a fresh `useState(initialUrl)`. Both resets are unobservable.

Reduce `handleCancel` to `onCancel`, or pass `onCancel` directly to the button's `onClick`.

## G5 [MINOR] — document the retire-a-default constraint

`domain/sourceOverrides.ts:46-51`. An override row for a default carries `isDefault: true`, so if
that default is ever dropped from `data/defaultSources.ts` the row matches neither branch and
vanishes — silently discarding a source the user had configured.

**Do not change the behaviour.** The `!row.isDefault` guard is the anti-shadowing rule that stops a
hand-edited `sources.json` injecting a fake default, and the existing test
`"should ignore persisted entries that claim to be defaults"` pins it. I rejected inverting this in
round 1 and still reject it.

Record the constraint in `mergeOverridesOverDefaults`' docstring instead: retiring a shipped default
requires a migration, because override rows for it will otherwise be dropped.

## G6 [NIT] — two small things in files you are already touching

- `services/WatchedSourcesStorageService.ts`: `persist` filters out untouched defaults before
  writing, so it does not persist what it is given. Rename it `persistOverrides`.
- Same file, `loadSources`: restore the fail-soft invariant lost in the round-2 comment sweep —
  a missing or corrupt file yields the defaults rather than an error, and the next write repairs the
  file. The inline `// No usable file yet` covers the first half; the self-repair half is now
  undocumented.

## A note on the comment rule

This is the third architectural rationale removed by the comment cleanup — I restored two others
inline (`WatchedSourcesStorageService`'s server-side rationale and `summarizeSources`' failure
isolation). Rule 17 removes *narration*, never *rationale*, and it does not apply to code outside
the diff's scope at all. Trimming `"Summarises every watched source."` was correct; removing why one
unreachable portal must not fail the whole request was not.

## Out of scope

- Component-test infrastructure (G3). If we want it, it is its own mission.
- Changing the anti-shadowing behaviour (G5).
- `WatcherOrchestrator.ts` at 292 lines. It is the module's largest file and a composition root of
  ten short methods; it is the next thing to split **if an eleventh operation lands**, not now.
- Everything rejected in rounds 1 and 2: `isDefault` re-stamping, 400-vs-500 status codes, merging
  `AddSourceForm` with `EditSourceForm` (the reviewer independently agreed with that call).

## Definition of done

Full gauntlet green, real output pasted into `.agents/handoff/TO_ORCHESTRATOR.md`. **312 tests
minimum plus the new storage-level test from G1 — the count may only go up.** No assertion altered.
Report per id (G1-G6) and state plainly anything not done and why.

Do not commit.
