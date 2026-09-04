# CSV EWKB & WKT Spatial Map Visualization

> **Topic**: Parsing and visualizing PostGIS EWKB Hex and WKT geometries from CSV files.  
> **Status**: Implemented & Production Active

---

## 1. Overview

Tabular CSV files exported from PostGIS databases often contain spatial geometry columns in EWKB Hex (Extended Well-Known Binary) format (e.g. `0105000020D17F0000...`) or WKT (Well-Known Text) format (e.g. `POLYGON((...))`).

The [`CsvParser.ts`](src/services/parsers/CsvParser.ts) service decodes these spatial geometry columns into standard GeoJSON FeatureCollections in memory, enabling direct map preview and spatial auditing for CSV sources.

---

## 2. Geometry Decoding Pipeline

1. **EWKB Hex Parsing** ([`ewkbParser.ts`](src/utils/ewkbParser.ts)):
   - Decodes binary byte arrays, endianness flag, geometry type, and SRID presence.
   - Automatically converts UTM Zone 19S (EPSG:32719) metric coordinates (`utm19sToWgs84`) to WGS84 latitude/longitude degrees.

2. **WKT Text Parsing** ([`wktParser.ts`](src/utils/wktParser.ts)):
   - Parses `POINT(x y)`, `LINESTRING(...)`, `POLYGON(...)`, and `MULTIPOLYGON(...)` geometry strings.

3. **Latitude / Longitude Fallback**:
   - Detects coordinate column aliases (e.g., `lat`, `latitude`, `lng`, `lon`, `x`, `y`) and constructs Point geometries.
