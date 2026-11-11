# Cartography watcher: direct URL sources (WD-1 to WD-18, WD-6b)

## Context

The watcher only knows CKAN datasets. Some layers are published only as a service URL, for example the ANEP centres layer of IDEuy (`INE_NO_SEGURO_CLON_NS:centros_anep_2`), which is not in any CKAN dataset and not in the WFS capabilities, so it cannot be listed any other way. Its zipped shapefile is a direct `GetFeature` request:

```
https://mapas.ide.uy/geoserver-vectorial/INE_NO_SEGURO_CLON_NS/wfs?service=WFS&version=1.0.0&request=GetFeature&typeName=INE_NO_SEGURO_CLON_NS:centros_anep_2&outputFormat=SHAPE-ZIP
```

A new kind of source, **URL directa**, lets the user register such a URL once. It then appears in the *Catálogo Cartográfico* tab of the shapefile sync tool, and selecting it downloads the zip on the server and hands it to the tool, so nobody has to download it to a PC and upload it again (see `ROUTINE_JOBS_CENTROS_ANEP_SPEC.md`).

A direct source publishes no checksum, date or size, so the watcher has nothing to compare. By decision it is **downloaded on every use and never stored in the vault**. The vault, the delta rules and the source summaries do not apply to it.

Facts from the code (not rules): `WatchedSource` has `id`, `title`, `datasetSlug`, `portalHost`, `description`, `isDefault`; sources are persisted in `data/vault/sources.json` (only non-default or modified rows); `catalog/file?dataset=<datasetSlug>&resource=<id>` returns the bytes as an attachment; `WatcherOrchestrator.resolveSource` matches a source by `datasetSlug`.

## Source model

- WD-1: `WatchedSource` gains an optional `kind` (`"ckan"` or `"direct-url"`). A row without `kind` (every row already persisted) is `"ckan"`, so no existing `sources.json` needs migrating.
- WD-2: A `direct-url` source also carries `directUrl` (the `http://` or `https://` URL). Its `datasetSlug` is its `id` (the slug of the title) and its `portalHost` is the host of the URL, so the existing lookups, the collision check on `id` and the storage keep working. A `direct-url` source is never `isDefault` (it is not shipped with the module).
- WD-3: The `kind` constants live beside the others in `types.ts` (no string literals in the logic).

## Adding and removing

- WD-4: `POST sources` accepts `{ kind: "direct-url", title, url }`. Without `kind` it behaves as before (CKAN). `title` is required for a direct URL (400 with a Spanish message if empty); the `id` is the sanitized slug of the title, and it is refused if it already exists, as for CKAN sources.
- WD-5: The URL must be `http` or `https` and parse as a URL; any other scheme (`file:`, `ftp:`, `data:`) is refused with a Spanish message. The same URL registered twice is refused.
- WD-6: Before saving, the server downloads the URL once and checks the answer: HTTP 2xx, within the size cap (WD-10), starting with the ZIP signature `PK\x03\x04`, and holding a shapefile (WD-6b). Anything else is refused with a Spanish message that says what was wrong (connection failed, HTTP status, not a ZIP, too big, no shapefile inside). The bytes are discarded, never stored.
- WD-6b: Shapefile check: the entry names of the ZIP (read from its central directory, no extraction to disk) must include at least one set `<name>.shp`, `<name>.dbf` and `<name>.shx` with the same base name (case-insensitive, entries inside folders count). A missing part is named in the message ("El ZIP no contiene el archivo .dbf del shapefile."). A missing `.prj` is accepted, because the sync tool asks for the SRID, and is reported as a warning in the add and edit result and in the dashboard card ("Sin archivo .prj: se pedirá el SRID al cargar."). A ZIP with several shapefile sets is accepted. The check is one pure function shared by add, edit and download.
- WD-7: `POST sources/remove` removes a direct source like any user source; nothing is deleted from the vault because nothing is there.
- WD-8: `POST sources/update` on a direct source accepts `{ sourceId, title?, url? }` (at least one of `title` and `url`; else 400). The `id` never changes, so a new title changes only the shown title. A new `url` must pass WD-5 and WD-6 (and WD-6b) and must not belong to another source (`directUrl` compared case-insensitive); `portalHost` is updated to the new host. An unchanged `url` is not downloaded again. Nothing is saved when the validation fails. On a CKAN source the endpoint behaves as before, and a `kind` change through `update` is refused.

## Catalogue and download

- WD-9: `GET catalog` returns each direct source as a group with exactly one resource: `id` = the source `id`, `name` = the title plus `.zip`, `format` = `SHP`, `sizeBytes` and `lastModified` `null`, `isCached` `false`. It is listed for the `ALL` and `SHP` filters and omitted for `CSV`. Building the catalogue does not call the URL (no request per direct source), so a slow or down service does not slow the tree.
- WD-10: `GET catalog/file?dataset=<id>&resource=<id>` for a direct source downloads the URL on the server and returns the bytes as an attachment named `<id>.zip`. It never reads or writes the vault. Timeout 60 s and size cap 100 MB (constants); a response above the cap is aborted.
- WD-11: The download is validated as in WD-6 and WD-6b on every call (HTTP 2xx, ZIP signature, shapefile parts). A failure is a 500 with the Spanish message; it never returns the service's error body as a file.
- WD-12: Source summaries (`GET summaries`) report a direct source without calling the URL, with a new badge state `ON_DEMAND` ("Se descarga en cada uso"), `totalResources` 1 and `pendingCount` 0. It does not count towards the "updates available" total of the home card.

## UI

- WD-13: The add-source form of the dashboard gets a selector "Conjunto CKAN" / "URL directa". With "URL directa" it shows a "Título" field and a "URL" field; the validation of WD-6 runs on submit and its message is shown in the form.
- WD-14: The dashboard card of a direct source shows the title, the host and the label "Se descarga en cada uso", no vault or update information, and the buttons "Editar" and "Eliminar". "Editar" opens the existing edit form (`EditSourceForm`) with "Título" and "URL" for a direct source, runs WD-8 on save and shows its error in the form.
- WD-15: In the Catálogo Cartográfico tab the direct group looks like any other (title, its one file); the file is selected and passed to the sync tool as any catalogue file. No cached icon is shown.

## Documentation and tests

- WD-16: The wiki pages `fuentes-vigiladas.md` and `catalogo-cartografico.md` of the module explain the URL directa, with the ANEP URL as the example and the note that it is downloaded on every use and never kept. `CARTOGRAPHY_WATCHER_MODULE.md` gets a short section.
- WD-17: Unit tests per the project's testing standards: URL validation (schemes, duplicates), ZIP signature check, shapefile part check (all parts, each part missing, `.prj` missing as warning, folders, case, several sets), edit (title only, URL change validated, unchanged URL not downloaded, duplicate URL refused, failure saves nothing, `kind` change refused), size cap, timeout, `kind` defaulting for old rows, catalogue mapping (included for `ALL` and `SHP`, omitted for `CSV`), summary mapping (`ON_DEMAND`, no network call), handlers (400 cases, remove, update refusal, file attachment, vault never touched), UI add form and card. The module-removal test (delete the folder and nothing else breaks) keeps passing.

## Out of scope

- WD-18: Formats other than a zipped shapefile (CSV, GeoJSON), a cache or vault copy, change detection, credentials or headers for the URL, scheduled downloads. A direct source is not shipped as a default; the user adds the ANEP URL once.

## Risks

- The server fetches a URL typed by a user. The scheme restriction, the size cap and the timeout limit the damage; the tool is internal, so no host allow-list is added now. Add one if the tool is ever exposed outside the organisation.
- The ANEP layer URL depends on IDEuy continuing to answer anonymously for a layer it does not list. If the layer is renamed or hidden, WD-11 reports the failure with the HTTP status.

## Acceptance criteria count

WD-1 to WD-18 plus WD-6b (19 criteria).
