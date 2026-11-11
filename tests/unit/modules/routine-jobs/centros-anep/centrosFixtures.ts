import type { DbColumnMetadata } from "@/core/types/db";
import { CENTROS_DEFAULT_TABLES, CENTROS_ROLES, type CentrosTableRole } from "@/modules/routine-jobs/jobs/centros-anep/constants";
import type {
  CentrosFinalLayout,
  CentrosStagingLayout,
  CentrosStagingReport,
  CentrosTables,
} from "@/modules/routine-jobs/jobs/centros-anep/types";

export const column = (name: string, dataType: string, overrides: Partial<DbColumnMetadata> = {}): DbColumnMetadata => ({
  column_name: name,
  data_type: dataType,
  is_nullable: true,
  column_default: null,
  ...overrides,
});

export const GEOM_TYPE = "USER-DEFINED";

export const stagingCatalog = (): DbColumnMetadata[] => [
  column("ruee", "double precision"),
  column("x", "double precision"),
  column("y", "double precision"),
  column("subsistema", "text"),
  column("nombre", "text"),
  column("depto", "text"),
  column("rule_est", "double precision"),
  column("geom", GEOM_TYPE),
];

export const finalCatalog = (): DbColumnMetadata[] => [
  column("id", "integer", { is_nullable: false, column_default: "nextval('carto.ine_centros_anep_id_seq'::regclass)" }),
  ...stagingCatalog(),
];

const identityOf = (names: readonly string[]): Record<string, string> =>
  Object.fromEntries(names.map((name) => [name, name]));

const LOGICAL = ["ruee", "subsistema", "nombre", "geom"];

export const stagingLayout = (srid: number | undefined = 32721): CentrosStagingLayout => ({
  layout: { ...CENTROS_DEFAULT_TABLES["centros-anep-staging"], columns: identityOf(LOGICAL) },
  catalog: stagingCatalog(),
  srid,
});

export const finalLayout = (srid = 32721): CentrosFinalLayout => ({
  ...CENTROS_DEFAULT_TABLES["centros-anep-final"],
  columns: identityOf(LOGICAL),
  srid,
  idColumn: "",
  idSequence: null,
  identityColumns: [],
  catalog: finalCatalog(),
});

export const centrosTables = (): CentrosTables =>
  Object.fromEntries(CENTROS_ROLES.map((role) => [role, { ...CENTROS_DEFAULT_TABLES[role] }])) as CentrosTables;

export const centrosTablesBody = (): Record<CentrosTableRole, { schema: string; table: string }> => centrosTables();

export const cleanStaging = (overrides: Partial<CentrosStagingReport> = {}): CentrosStagingReport => ({
  rows: 2902,
  bySubsistema: [
    { value: "CEIP", rows: 2269 },
    { value: "CES", rows: 323 },
    { value: "CETP", rows: 278 },
    { value: "CFE", rows: 32 },
  ],
  emptyGeometry: 0,
  nullRuee: 0,
  nullSubsistema: 0,
  repeatedGroups: 0,
  repeatedRows: 0,
  repeatedRuee: [],
  damagedTextRows: 0,
  unsupportedSridRows: 0,
  ...overrides,
});
