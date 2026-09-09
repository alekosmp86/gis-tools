# Cartography Watcher — Module

Watches open CKAN portals for republished cartographic datasets, keeps a local vault of what has
been downloaded, and lets the sync tools pull a departmental file straight from the catalogue.

It is a **module**, not a core tool: everything lives in `src/modules/cartography-watcher/`, and the
only file outside it that names it is the composition root. Delete the folder, its registry line and
its test folder, and the application is exactly what it was before.

---

## 1. What it does

Comparing a PostGIS table against official cartography used to mean: check the portal by hand, notice
a new release, download 20–100 MB, find the file, then open a sync tool and upload it. The watcher
closes that loop:

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
  module.routes.json     six endpoints and one owned page
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
3. **File size**, consulted only when neither of the above is available. A same-length edit is common
   enough that size alone is weak evidence.

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

## 6. Editing watched sources

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
  resources. If the destination already exists, both directories are left untouched to prevent overwriting
  existing files.

## 7. Verified against the live portal

- `catalog?format=CSV` returned both shipped sources with 19 departmental CSVs each.
- A cold `catalog/file` fetched 1 278 337 bytes and wrote `flores.csv` plus its sidecar; the next
  request returned the same bytes without transferring the file again.
- `summaries` reported `NOT_DOWNLOADED, 20/21 pendientes` for a source with one file downloaded — the
  badge agrees with its own count.
- The dashboard, the home card and the generated page all render; deleting the module returns the
  route table to its previous state.

## 8. Deliberately not built

- **Auto-load by query parameter.** The earlier prototype let the dashboard hand a file to a sync
  tool through `?sourceSlug=&resourceId=`, which required core uploaders to know about an extension
  contract. The catalogue tab reaches the same outcome from inside the tool.
- **Vault eviction**, as above.
- **A forced re-download endpoint.** Reads refresh themselves, so it had no caller.
