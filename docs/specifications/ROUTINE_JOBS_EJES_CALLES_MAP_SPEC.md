# Routine jobs: map of splits and merges of "Carga de ejes de calles" (EM-1 to EM-17)

## Context

The analysis report of the ejes job lists SPLIT ("Divisiones") and MERGE ("Uniones") cases with only `reftramo` numbers. The user needs to see them on a map to judge them. Carga de padrones already has a map in a modal (`PadronMapModal`, `PadronMapBody`, `PadronMapView`, `usePadronMapFeatures`, `padronMapCollection`, `ShowOnMapButton`, `ReviewNavigation` in `src/modules/routine-jobs/ui/`). Those components are tied to padrones types; this change makes the generic parts shareable and builds the ejes map on them.

## Shared map UI (refactor, no change of padrones behaviour)

- EM-1: The generic map components live in `src/modules/routine-jobs/ui/map/` with generic names: `OutlineMapModal`, `OutlineMapBody` (+ css), `OutlineMapView` (+ css), `useOutlineMapFeatures`, `outlineMapCollection`, `ShowOnMapButton` (+ css), `ReviewNavigation`. Files are moved with `git mv` so history follows. Padrones keeps its own `padronMapSubject`, `PadronOutlineDetails`, `PadronReviewDecision` and a thin `PadronMapModal` built on the shared modal.
- EM-2: `useOutlineMapFeatures` receives a `fetch(items)` function and a cache scope instead of calling the padrones client; items are opaque to it. The padrones map keeps requesting only items not cached yet, one request per change of the missing items, and keeps showing the loading, error with "Reintentar" and empty states.
- EM-3: `OutlineMapView` receives the title, empty message, label property and the map features; the colour of an outline is its role (old or new) or its own colour type, as now. The click on an outline selects it and the click on the background clears it, as now.
- EM-4: `OutlineMapBody` shows the map beside a details column; the details panel and the aside controls are passed in by the caller. Without a connection password it shows the same notice as padrones.
- EM-5: After EM-1 to EM-4 every padrones map behaviour and every existing padrones test passes. Tests move to `tests/unit/modules/routine-jobs/ui/map/` and only imports and names change; a test that would need a behaviour change is reported before it is changed.

## Endpoint

- EM-6: `POST ejes-calles/geometry-map` (in `module.routes.json`) with the connection (password in the body, never logged or returned), the table schemas and names of `road_section` and the staging table, and `items`: each item is `{ oldRef }` (a `road_section.reftramo_ideuy`) or `{ newRef }` (a staging `reftramo`). Spanish errors, status codes as the padrones geometry map (400 invalid request, 404 not found, 500 read failure).
- EM-7: One request may carry at most 30 items. More than 30 is refused with 400 and a Spanish message. The client never sends more than 30.
- EM-8: The read is one read-only transaction that is rolled back, with a statement timeout of 20 s. It uses the shared table resolution helpers; the road section and the staging geometry are transformed from their resolved SRID to 4326 and simplified (2 m tolerance, as the padrones map), returned as GeoJSON with the item index, a role (old or new) and a label (`Tramo anterior <reftramo>` or `Tramo nuevo <reftramo>`).
- EM-9: An old `reftramo` with no `road_section` row, or a new `reftramo` with no staging row, or one with an empty geometry, answers 404 with a message that names the `reftramo`. Several staging rows can share a `reftramo` (one per locality or department the section crosses) with the same geometry, `idcalle`, name, type and fuente (checked on dev: 27,206 groups, none differ); the read takes one of them.

- EM-17: The "Divisiones" and "Uniones" tables show three lengths in metres per row: the old section(s), the new section(s) and the part of the new section(s) that lies outside the old one(s) (beyond 1 m), so the user can tell a plain split or merge from one where the new sections extend further.

## UI

- EM-10: Each row of the "Divisiones" and "Uniones" tables of the report has a "Ver en mapa" button (`ShowOnMapButton`). Plain removals, new streets and attribute changes have none.
- EM-11: The button opens a modal. Title "División de tramo" for a split and "Unión de tramos" for a merge. The old section(s) are drawn in the old colour and the new section(s) in the new colour, each labelled `<reftramo> · anterior` or `<reftramo> · nuevo`.
- EM-12: Clicking an outline shows its details beside the map: `reftramo`, role, `idcalle`, and for the row: access points and coverage. Details of the row not tied to one outline (access points, coverage) are shown whether or not an outline is selected.
- EM-13: The modal has previous and next buttons that move through the rows of the table it was opened from (`ReviewNavigation`), keeping the dialog and its cache.
- EM-14: A row with more than 30 outlines (old plus new) draws the first 30 and shows the note "Se muestran 30 de N tramos."
- EM-15: When the wizard holds no connection password (for example after "Volver a la lista"), the buttons are enabled but the modal shows "Escriba la contraseña de la conexión en el paso de conexión para ver el mapa." instead of a map, as padrones.
- EM-16: The map opens only on the report of an analysis, never writes anything, and its endpoint is covered by the same "no secrets in logs or responses" rule as the other routine jobs.

## Documentation and tests

- Unit tests per the project's testing standards: the SQL builders, request parsing (limit of 30, item shapes), the subject builder (split and merge to outlines, truncation note), the hook with an injected `fetch`, the buttons and the modal. Shared map tests keep covering padrones.
- A line in `docs/tools` and the ejes wiki page when it exists.

## Out of scope

- Maps for plain removals, new streets and attribute changes.
- Editing or accepting rows from the map (the accept lists belong to the apply step, EJ-13).
- Changing the SPLIT or MERGE classification.

## Acceptance criteria count

EM-1 to EM-17 (17 criteria).
