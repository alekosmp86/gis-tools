import type { DbColumnsResponse, MockBackendOptions } from "../support/mockBackend";

export const SOURCE_DB = {
  host: "db-origen.example.test",
  database: "catastro_origen",
  user: "lector_catastro",
  password: "contrasena-ficticia",
  table: "parcelas",
};

export const TARGET_DB = {
  host: "db-replica.example.test",
  database: "catastro_replica",
  user: "editor_replica",
  password: "contrasena-ficticia",
  table: "parcelas",
};

const SAVED_PROFILES = [
  {
    name: "Catastro - Producción",
    config: { host: "db-origen.example.test", port: "5432", db_name: "catastro_origen", user: "lector_catastro", schema_name: "public", table_name: "parcelas" },
  },
  {
    name: "Catastro - Réplica",
    config: { host: "db-replica.example.test", port: "5432", db_name: "catastro_replica", user: "editor_replica", schema_name: "public", table_name: "parcelas" },
  },
  {
    name: "Pruebas local",
    config: { host: "localhost", port: "5432", db_name: "pruebas", user: "postgres", schema_name: "public", table_name: "parcelas_prueba" },
  },
  {
    name: "Catastro - Histórico 2023",
    config: { host: "db-historico.example.test", port: "5432", db_name: "catastro_historico", user: "lector_catastro", schema_name: "archivo", table_name: "parcelas_2023" },
  },
];

const PROFILES_STORAGE_KEY = "gis_tools_saved_db_profiles_v1";

export function buildProfilesSeedScript(): { key: string; value: string } {
  const now = Date.now();
  const profiles = SAVED_PROFILES.map((profile, index) => ({
    id: `profile-demo-${index + 1}`,
    name: profile.name,
    config: profile.config,
    updatedAt: now - index * 60_000,
  }));
  return { key: PROFILES_STORAGE_KEY, value: JSON.stringify(profiles) };
}

export interface ColumnSpec {
  name: string;
  type: string;
  nullable?: boolean;
  defaultValue?: string;
  primaryKey?: boolean;
}

export function buildColumnsResponse(table: string, totalRows: number, specs: ColumnSpec[]): DbColumnsResponse {
  return {
    success: true,
    schema: "public",
    tableName: table,
    columns: specs.map((spec) => spec.name),
    columnDetails: specs.map((spec) => ({
      column_name: spec.name,
      data_type: spec.type,
      is_nullable: spec.nullable ?? true,
      column_default: spec.defaultValue ?? null,
      is_primary_key: spec.primaryKey ?? false,
    })),
    primaryKeyColumn: "gid",
    totalRows,
  };
}

const SOURCE_COLUMN_SPECS: ColumnSpec[] = [
  { name: "gid", type: "integer", nullable: false, defaultValue: "nextval('parcelas_gid_seq'::regclass)", primaryKey: true },
  { name: "padron", type: "character varying(20)", nullable: false },
  { name: "departamento", type: "character varying(50)" },
  { name: "localidad", type: "character varying(80)" },
  { name: "area_m2", type: "numeric(12,2)" },
  { name: "uso_suelo", type: "character varying(40)" },
  { name: "observaciones", type: "text" },
];

const TARGET_COLUMN_SPECS: ColumnSpec[] = [
  { name: "gid", type: "integer", nullable: false, defaultValue: "nextval('parcelas_gid_seq'::regclass)", primaryKey: true },
  { name: "padron", type: "character varying(20)", nullable: false },
  { name: "departamento", type: "character varying(50)" },
  { name: "localidad", type: "character varying(80)" },
  { name: "area_m2", type: "numeric(12,2)" },
  { name: "uso_suelo", type: "character varying(40)" },
  { name: "id_carga", type: "integer", defaultValue: "nextval('parcelas_id_carga_seq'::regclass)" },
];

const SOURCE_COLUMNS_RESPONSE = buildColumnsResponse("parcelas", 6, SOURCE_COLUMN_SPECS);
const TARGET_COLUMNS_RESPONSE = buildColumnsResponse("parcelas", 5, TARGET_COLUMN_SPECS);

const COLUMN_TYPES = {
  gid: "integer",
  padron: "character varying(20)",
  departamento: "character varying(50)",
  localidad: "character varying(80)",
  area_m2: "numeric(12,2)",
  uso_suelo: "character varying(40)",
};

const SOURCE_ROWS = [
  { gid: 1, padron: "10234", departamento: "Montevideo", localidad: "Montevideo", area_m2: "412.50", uso_suelo: "Residencial", observaciones: null },
  { gid: 2, padron: "10235", departamento: "Montevideo", localidad: "Montevideo", area_m2: "380.00", uso_suelo: "Comercial", observaciones: null },
  { gid: 3, padron: "20871", departamento: "Canelones", localidad: "Las Piedras", area_m2: "605.75", uso_suelo: "Residencial", observaciones: null },
  { gid: 4, padron: "20872", departamento: "Canelones", localidad: "Las Piedras", area_m2: "598.10", uso_suelo: "Industrial", observaciones: null },
  { gid: 5, padron: "31560", departamento: "Maldonado", localidad: "Punta del Este", area_m2: "720.00", uso_suelo: "Turístico", observaciones: null },
  { gid: 6, padron: "31561", departamento: "Maldonado", localidad: "Punta del Este", area_m2: "455.30", uso_suelo: "Residencial", observaciones: null },
];

const TARGET_ROWS = [
  { gid: 1, padron: "10234", departamento: "Montevideo", localidad: "Montevideo", area_m2: "412.50", uso_suelo: "Residencial", id_carga: 1 },
  { gid: 2, padron: "10235", departamento: "Montevideo", localidad: "Montevideo", area_m2: "380.00", uso_suelo: "Residencial", id_carga: 2 },
  { gid: 3, padron: "20871", departamento: "Canelones", localidad: "Las Piedras", area_m2: "605.75", uso_suelo: "Residencial", id_carga: 3 },
  { gid: 4, padron: "20872", departamento: "Canelones", localidad: "Las Piedras", area_m2: "598.10", uso_suelo: "Industrial", id_carga: 4 },
  { gid: 7, padron: "40012", departamento: "Rocha", localidad: "La Paloma", area_m2: "510.00", uso_suelo: "Turístico", id_carga: 5 },
];

function buildMeta(totalCount: number) {
  return { type: "META", totalCount, columnTypes: COLUMN_TYPES, detectedSrid: 4326 };
}

export function buildChunk(rows: Array<Record<string, unknown>>) {
  return { type: "CHUNK", current: rows.length, total: rows.length, rows };
}

export function buildNdjsonStream(meta: object, chunk: object): string {
  return [meta, chunk, { type: "DONE" }].map((message) => JSON.stringify(message)).join("\n") + "\n";
}

function isTargetRequest(body: Record<string, unknown>): boolean {
  return body.db_name === TARGET_DB.database;
}

export const CONNECTED_MOCKS: MockBackendOptions = {
  columns: (body) => (isTargetRequest(body) ? TARGET_COLUMNS_RESPONSE : SOURCE_COLUMNS_RESPONSE),
  recordsStream: (body) => {
    if (isTargetRequest(body)) {
      const rows = typeof body.limit === "number" ? TARGET_ROWS.slice(0, body.limit) : TARGET_ROWS;
      return buildNdjsonStream(buildMeta(TARGET_ROWS.length), buildChunk(rows));
    }
    return buildNdjsonStream(buildMeta(SOURCE_ROWS.length), buildChunk(SOURCE_ROWS));
  },
  execute: { success: true, affectedRows: 8, message: "Ejecución exitosa." },
};
