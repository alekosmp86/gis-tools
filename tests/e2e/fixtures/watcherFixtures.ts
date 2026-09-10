/**
 * Fixtures for Cartography Watcher module API endpoints.
 */

export const DEFAULT_WATCHED_SOURCES = [
  {
    id: "src-catastro-default",
    title: "Catastro Nacional de Parcelas",
    datasetSlug: "catastro-nacional",
    portalHost: "catalogodatos.gub.uy",
    description: "Cartografía oficial de parcelas rurales y urbanas.",
    isDefault: true,
  },
  {
    id: "src-vialidad-custom",
    title: "Red Vial Nacional",
    datasetSlug: "red-vial-nacional",
    portalHost: "catalogodatos.gub.uy",
    description: "Capa de ejes viales y rutas nacionales.",
    isDefault: false,
  },
];

export const DEFAULT_SOURCE_SUMMARIES = [
  {
    sourceId: "src-catastro-default",
    datasetSlug: "catastro-nacional",
    title: "Catastro Nacional de Parcelas",
    status: "UP_TO_DATE",
    totalResources: 4,
    pendingCount: 0,
    checkedAt: "2026-09-10T10:00:00.000Z",
  },
  {
    sourceId: "src-vialidad-custom",
    datasetSlug: "red-vial-nacional",
    title: "Red Vial Nacional",
    status: "UPDATE_AVAILABLE",
    totalResources: 2,
    pendingCount: 1,
    checkedAt: "2026-09-10T10:00:00.000Z",
  },
];

export const DEFAULT_CATALOG_GROUPS = [
  {
    sourceId: "src-catastro-default",
    datasetSlug: "catastro-nacional",
    title: "Catastro Nacional de Parcelas",
    description: "Cartografía oficial de parcelas rurales y urbanas.",
    resources: [
      {
        id: "res-csv-1",
        name: "parcelas_montevideo.csv",
        format: "CSV",
        sizeBytes: 10240,
        lastModified: "2026-08-01T00:00:00.000Z",
        isCached: true,
      },
      {
        id: "res-shp-1",
        name: "parcelas_montevideo.zip",
        format: "SHP",
        sizeBytes: 45000,
        lastModified: "2026-08-01T00:00:00.000Z",
        isCached: false,
      },
    ],
  },
  {
    sourceId: "src-vialidad-custom",
    datasetSlug: "red-vial-nacional",
    title: "Red Vial Nacional",
    description: "Capa de ejes viales y rutas nacionales.",
    resources: [
      {
        id: "res-shp-2",
        name: "rutas_nacionales.zip",
        format: "SHP",
        sizeBytes: 85000,
        lastModified: "2026-08-15T00:00:00.000Z",
        isCached: true,
      },
      {
        id: "res-csv-2",
        name: "ejes_rutas.csv",
        format: "CSV",
        sizeBytes: 15400,
        lastModified: "2026-08-15T00:00:00.000Z",
        isCached: false,
      },
    ],
  },
];

export const SAMPLE_CATALOG_FILE_CSV = `suid,departamento,codigo,area
PAD-001,MONTEVIDEO,A1,100
PAD-002,CANELONES,B2_DIFF,250
PAD-004,ROCHA,D4,500
`;
