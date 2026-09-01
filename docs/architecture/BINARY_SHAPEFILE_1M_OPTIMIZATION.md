# High-Capacity Shapefile Processing Engine (1M+ Records)

This document details the architectural design, memory optimizations, and streaming techniques implemented in **GIS Tools** to load, preview, and compare large-scale ESRI Shapefiles ($1{,}000{,}000+$ records) in browser RAM without V8 heap exhaustion or UI thread blocking.

---

## 🎯 1. The Challenge: Web Performance at 1M Scale

When loading a large cadastral Shapefile (e.g. `paisurbano_shp.zip` with 1,051,248 polygons / points):
1. **GeoJSON Memory Explosion**: Eagerly converting 1.05M records into GeoJSON Feature objects created over **3.5 million JavaScript objects** (`Feature`, `Geometry`, `Properties` hash maps), demanding >2.5 GB of V8 heap and triggering fatal browser `Out of Memory (OOM)` tab crashes.
2. **DOM / Leaflet Layer Exhaustion**: Creating 1,051,248 Leaflet `L.CircleMarker` or `L.Path` layer instances allocated millions of event listener closures, exhausting main thread memory.
3. **Redundant Exact-Match Payload Bloat**: Storing all 1,051,248 records as discrepancy items in the worker result message produced a >500 MB structured payload, stalling `postMessage()` serialization.

---

## 🏗️ 2. Architectural Solution: Zero-Allocation Binary Streaming

The high-capacity architecture replaces eager object instantiation with native typed array binary readers and lazy decoders:

```
                  ┌──────────────────────────────────────────────┐
                  │          paisurbano_shp.zip (250 MB)         │
                  └──────────────────────┬───────────────────────┘
                                         │
                       extractShapefileZip() (but-unzip)
                                         │
                    ┌────────────────────┴────────────────────┐
                    ▼                                         ▼
            [dbfBuffer (Uint8Array)]               [shpBuffer (Uint8Array)]
                    │                                         │
        BinaryDbfReader (Zero-copy)               BinaryShpReader (Offsets Index)
                    │                                         │
                    ├─ StringInternPool (Deduplication)       ├─ Record Offsets Uint32Array
                    ├─ Direct Uint8Array.subarray Views       └─ Lazy readGeometry(i)
                    │
                    ├─ Map Preview Sample: 50,000 features ──▶ [Leaflet Map Canvas]
                    │
                    ▼ Transferable ArrayBuffers via postMessage()
    ┌──────────────────────────────────────────────────────────────────────────┐
    │                        Web Worker Comparison Core                        │
    │  ├─ Phase 1: DB Composite SUID Indexing                                  │
    │  ├─ Phase 2: Binary DBF Pointer Indexing (suid -> number[])              │
    │  ├─ Phase 3: Exact Matches Atomic Counter (exactMatchesCount++)          │
    │  ├─ Phase 4: Lazy Geometry Decoding for Mismatches                       │
    │  └─ Phase 5: PostGIS ST_SetSRID / ST_Transform INSERT Generation         │
    └──────────────────────────────────────────────────────────────────────────┘
```

---

## 🧩 3. Core Engine Components

### A. [`StringInternPool.ts`](file:///c:/Alekos/Projects/gis-tools/src/utils/stringInternPool.ts)
Categorical attributes in Shapefiles (such as department names, municipality codes, land-use tags) repeat across hundreds of thousands of rows.
- The `StringInternPool` acts as a canonical string cache (`Map<string, string>`).
- If `"CANELONES"` appears 200,000 times, only **one single string instance** is allocated in RAM, eliminating hundreds of megabytes of redundant V8 string allocations.

### B. [`BinaryDbfReader.ts`](file:///c:/Alekos/Projects/gis-tools/src/utils/binaryDbfReader.ts)
- **Zero Slices**: Reads dBase III/IV records directly from the underlying typed buffer using `Uint8Array.subarray` views instead of copying `ArrayBuffer.slice()`.
- **Selective Column Extraction**: Fields are only decoded on-demand using `readFieldValue(recordIndex, fieldDescriptor)`.
- **Character Encoding Support**: Native `TextDecoder` supporting `windows-1252`, `iso-8859-1`, and `utf-8` via `.cpg` metadata.

### C. [`BinaryShpReader.ts`](file:///c:/Alekos/Projects/gis-tools/src/utils/binaryShpReader.ts)
- **Fast Offset Indexing**: Rapidly scans the 100-byte main header and record headers to populate lightweight `Uint32Array` offset index tables.
- **Lazy Geometry Decoder**: `readGeometry(recordIndex)` converts raw ESRI shape byte slices into standard GeoJSON `Geometry` objects only when a record requires spatial comparison or map rendering.

### D. [`zipArchiveExtractor.ts`](file:///c:/Alekos/Projects/gis-tools/src/utils/zipArchiveExtractor.ts)
- Powered by `but-unzip` for ultra-fast, in-memory archive decompression.
- Extracts `.shp`, `.dbf`, `.shx`, `.prj`, and `.cpg` concurrently using `Promise.all`.

---

## 🗺️ 4. Initial Map Preview Strategy (50k Representative Sample)

To provide an immediate, rich spatial preview without crashing Leaflet:
1. When parsing a dataset with $>50{,}000$ features, [`ShapefileParser.ts`](file:///c:/Alekos/Projects/gis-tools/src/services/parsers/ShapefileParser.ts) generates a GeoJSON collection containing the **first 50,000 features** for the initial map step.
2. The full binary buffers (`dbfBuffer`, `shpBuffer`) and total feature count ($1{,}051{,}248$) are preserved in the dataset model.
3. The UI renders a high-contrast warning banner informing the user:
   > *"Vista previa de muestra: Mostrando 50.000 de 1.051.248 entidades en el mapa inicial para asegurar fluidez de navegación. La totalidad de los 1.051.248 registros se auditará en los pasos siguientes."*

---

## ⚡ 5. Web Worker Comparison Optimizations

### A. Index by Row Pointer (`suidKey -> number[]`)
Instead of copying 1M objects into a JavaScript `Map<string, Object[]>`, the worker maps composite SUIDs to record indices (`number[]`), reducing indexing memory from >1.2 GB to **< 35 MB**.

### B. Atomic Exact-Match Counting
In typical comparison jobs, $>90\%$ of records match perfectly between the database and the Shapefile:
- Exact matches simply increment an atomic counter: `exactMatchesCount++`.
- Discrepancy objects (`DiscrepancyItem`) are **only created for actual differences** (attribute mismatches, geometry differences, duplicates, missing rows).
- Output payload sent back from the worker drops from $>500\text{ MB}$ to **$< 2\text{ MB}$**.

### C. Automatic PostGIS Geometry INSERT Generation
For features found only in the source Shapefile:
- The worker automatically discovers the database table's spatial column (`geom`, `geometry`, `wkb_geometry`, or PostGIS type `geometry`/`USER-DEFINED`).
- Formats the PostGIS spatial expression:
  ```sql
  ST_SetSRID(ST_GeomFromGeoJSON('{"type":"Polygon",...}'), 4326)
  -- Or with projected coordinate transformation:
  ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON('...'), 4326), {targetSrid})
  ```
- Appends the geometry column and spatial expression directly to the generated `sqlInsertScript`.
