export interface SpatialColumnHeaders {
  geomColHeader?: string;
  latColHeader?: string;
  lngColHeader?: string;
}

const GEOMETRY_HEADER_PATTERN = /^(geom|geometry|wkt|wkb_geometry|the_geom|geom_wkt|geom_wkb)$/i;
const LATITUDE_HEADER_PATTERN = /^(lat|latitude|latitud|y_coord|y)$/i;
const LONGITUDE_HEADER_PATTERN = /^(lng|lon|long|longitude|longitud|x_coord|x)$/i;

export function detectCsvDelimiter(sampleLine: string): string {
  let commaCount = 0;
  let semiCount = 0;
  let tabCount = 0;
  let inQuotes = false;

  for (let charIndex = 0; charIndex < sampleLine.length; charIndex++) {
    const char = sampleLine[charIndex];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (!inQuotes) {
      if (char === ",") commaCount++;
      else if (char === ";") semiCount++;
      else if (char === "\t") tabCount++;
    }
  }

  if (semiCount > commaCount && semiCount > tabCount) return ";";
  if (tabCount > commaCount && tabCount > semiCount) return "\t";
  return ",";
}

export function resolveSpatialColumnHeaders(headers: string[]): SpatialColumnHeaders {
  return {
    geomColHeader: headers.find((header) => GEOMETRY_HEADER_PATTERN.test(header.trim())),
    latColHeader: headers.find((header) => LATITUDE_HEADER_PATTERN.test(header.trim())),
    lngColHeader: headers.find((header) => LONGITUDE_HEADER_PATTERN.test(header.trim())),
  };
}

export function hasSpatialColumns(headers: string[]): boolean {
  const { geomColHeader, latColHeader, lngColHeader } = resolveSpatialColumnHeaders(headers);
  return geomColHeader !== undefined || (latColHeader !== undefined && lngColHeader !== undefined);
}
