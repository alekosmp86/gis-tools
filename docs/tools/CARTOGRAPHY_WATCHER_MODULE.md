# Cartography Watcher — Module

Watches open CKAN portals for republished cartographic datasets, keeps a local vault of what has
been downloaded, and lets the sync tools pull a departmental file straight from the catalogue.

It is a **module**, not a core tool: everything lives in `src/modules/cartography-watcher/`, and the
only file outside it that names it is the composition root. Delete the folder, its registry line and
its test folder, and no other file needs changing.

---

## 1. What it does

Comparing a PostGIS table with official cartography requires checking the portal by hand, noticing a
new release, downloading 20–100 MB, finding the file, then opening a sync tool and uploading it. The
watcher closes that loop:

- **Delta detection.** Each resource published by a watched dataset is compared with the copy in the
  vault: `UP_TO_DATE`, `UPDATE_AVAILABLE` or `NOT_DOWNLOADED`.
- **A vault with read-through caching.** Requesting a file fetches it once and stores it. Later
  requests reuse the stored bytes, so re-running a comparison after adjusting a SUID mapping costs
  nothing.
- **Catalogue inside the sync tools.** The CSV and Shapefile uploaders grow a *Catálogo Cartográfico*
  tab beside *Subir desde PC*, listing exactly the files that tool can ingest.
- **Its own dashboard** at `/tools/m/cartography-watcher`, where sources are added, removed and
  checked.

## 2. Shape

```
src/modules/cartography-watcher/
  module.routes.json     seven endpoints and one owned page
  manifest.ts            binds handlers, the page, and two UI contributions
  types.ts               CKAN shapes, deltas, summaries, catalogue items
  data/defaultSources.ts the two IDEuy datasets shipped with the module
  domain/                pure: delta rules, naming, catalogue mapping, formatters
  services/              I/O: portal client, vault, source list, orchestrator
  api/handlers.ts        thin request handling
  ui/                    dashboard, catalogue tree, home card, badges
```

The split between `domain/` and `services/` is what makes the module testable: the rules that decide
whether a file is stale never touch a disk or a network, so they are covered by ordinary
deterministic tests.

## 3. HTTP surface

All under `/api/m/cartography-watcher`, all `runtime: nodejs` and `dynamic: force-dynamic` — the
vault and the portal are both server-side, and a cached catalogue would report stale deltas for ever.

| Method | Path | Purpose |
|---|---|---|
| GET | `sources` | the watched sources |
| POST | `sources` | add one, from a portal URL or a bare dataset identifier |
| POST | `sources/update` | update a source reference, refreshing metadata and moving vault |
| POST | `sources/remove` | remove a user-added source |
| GET | `summaries` | per-source badge, resource count and pending count |
| GET | `catalog?format=CSV\|SHP\|ALL` | the catalogue tree, filtered to what a tool can ingest |
| GET | `catalog/file?dataset=&resource=` | the file itself, fetched and cached on demand |

Removal and updates are POST rather than `DELETE` or `PUT sources/[id]` because a module handler receives only the
`Request`: a declared dynamic segment would have to be parsed out of the URL by hand.

## 4. How freshness is decided

Three signals, in descending order of trustworthiness:

1. **Checksum.** A mismatch means an update; a match settles the question and stops there. Publishers
   touch timestamps without republishing content, and re-fetching 100 MB for that is exactly what the
   vault exists to prevent.
2. **Publication timestamp**, when no usable checksum is published on both sides. Strictly newer is
   an update; equal or older is not.
3. **File size**, consulted only when the remote resource publishes neither a checksum nor a timestamp.
   A same-length edit is common, so size alone is weak evidence.

`GET catalog/file` re-checks metadata on every request and re-fetches when the local copy has been
superseded. The cheap half of the check always runs; what the vault saves is the transfer.

## 5. Where the data lives

```
data/vault/
  sources.json                       user-added sources
  <dataset-slug>/<file>              the downloaded resource
  <dataset-slug>/<resourceId>.meta.json   checksum, publication date, size, download instant
```

Git-ignored except for a `.gitkeep`. Sources are stored **server-side only**: the catalogue is read
while serving the sync tools, which cannot see a browser's storage, so a source saved only in
`localStorage` would be invisible exactly where it is needed.

The vault grows without bound. Eviction is not implemented.

## 6. Catalogue downloads and progress

The server does not stream `GET catalog/file`. The handler (`api/handlers.ts`, `readCatalogFile`)
calls `WatcherOrchestrator.getResourceFile`, which returns the vault copy when it is `UP_TO_DATE`,
and otherwise downloads the resource from the portal and writes it to the vault. Only then is the
complete body sent, with `Content-Length` set to its byte length. The vault write therefore finishes
before the browser receives any byte.

The browser reads that body as a stream. `fetchCatalogFile` in `ui/watcherClient.ts` reads the
response body with a stream reader and calls an optional `onProgress(phase, current, total)` callback:

- `phase` is always `"Descargando archivo..."`.
- `current` is the number of bytes received so far.
- `total` is the value of `Content-Length`, or `0` when the header is absent.
- A report is sent on the first chunk, then each time at least 64 KiB
  (`DOWNLOAD_PROGRESS_BYTE_INTERVAL`, `constants.ts`) has arrived since the last report.
- After the body ends, a final report is sent unless the last report already showed the full total.
  When `total` is `0`, the final report uses the received byte count as both values.
- A response with no body stream is read in one step and reported once as complete.

`CatalogTreeSelector.tsx` keeps the latest report in state and shows it on the row being downloaded
only. The row shows `NN%` when `total > 0` and `Descargando...` otherwise. The state is cleared when
the request settles.

Failures:

- A non-2xx response makes `fetchCatalogFile` throw `No se pudo obtener el archivo del catálogo
  (HTTP <status>).`. Errors raised while reading the body propagate with their own message.
- The message is shown in the catalogue tree's selection error (`expandedError`).
- The portal request for the metadata has a 20 s timeout. The resource download has no timeout.
- The vault write completes before the response is sent, so a browser-side read failure does not
  discard the cached file.

There is no cancel control. `fetchCatalogFile` accepts no `AbortSignal`, so a started download runs
until the body ends or fails.

## 7. Editing watched sources

Every card on the dashboard (including the shipped defaults) offers an **"Editar"** action:

- **Immutable ID.** The source retains its `id` and card position across edits. An edit mutates
  `datasetSlug`, `portalHost`, `title` and `description` without altering the opaque `id` handle.
- **Server-side validation & title refresh.** The CKAN portal is queried before persisting; invalid or
  unreachable references are rejected. `title` and `description` are refreshed from the portal metadata.
- **Default-override mechanism.** Shipped defaults can be edited when an open data portal moves a
  dataset to a new slug. Persisted entries in `sources.json` matching a default source `id` act as overrides
  merged on load, while `isDefault: true` is re-stamped. Edited defaults remain non-removable.
- **Collision prevention.** An edit resulting in a `portalHost` and `datasetSlug` already belonging to
  another watched source is refused with an explanatory Spanish message.
- **Vault follows slug.** On a slug change, the directory `data/vault/<oldSlug>` is renamed to
  `data/vault/<newSlug>` if the destination does not already exist, preserving previously downloaded cached
  resources and rewriting their sidecar paths. If the destination already exists, both directories are left untouched to prevent overwriting
  existing files.

## 8. Deliberately not built

- **Auto-load by query parameter.** The dashboard does not hand a file to a sync tool through a URL
  parameter, which would require core uploaders to know about an extension contract. The catalogue
  tab in each sync tool fetches the file directly.
- **Vault eviction**, as above.
- **A forced re-download endpoint.** Reads refresh the cache themselves. No endpoint forces a
  re-download; `WatcherOrchestrator.downloadResource` has no caller.
