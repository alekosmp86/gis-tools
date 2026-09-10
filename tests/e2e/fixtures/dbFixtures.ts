/**
 * Fixtures for PostgreSQL and PostGIS database API endpoints.
 */

export const DEFAULT_DB_COLUMNS_RESPONSE = {
  success: true,
  schema: "public",
  tableName: "parcelas_catastro",
  columns: ["gid", "suid", "departamento", "codigo", "geom"],
  columnDetails: [
    {
      column_name: "gid",
      data_type: "integer",
      is_nullable: false,
      column_default: "nextval('parcelas_gid_seq'::regclass)",
      is_primary_key: true,
    },
    {
      column_name: "suid",
      data_type: "character varying(50)",
      is_nullable: false,
      column_default: null,
      is_primary_key: false,
    },
    {
      column_name: "departamento",
      data_type: "character varying(50)",
      is_nullable: true,
      column_default: null,
      is_primary_key: false,
    },
    {
      column_name: "codigo",
      data_type: "character varying(20)",
      is_nullable: true,
      column_default: null,
      is_primary_key: false,
    },
    {
      column_name: "geom",
      data_type: "geometry(MultiPolygon,4326)",
      is_nullable: true,
      column_default: null,
      is_primary_key: false,
    },
  ],
  primaryKeyColumn: "gid",
  totalRows: 3,
};

export const DEFAULT_DB2_COLUMNS_RESPONSE = {
  ...DEFAULT_DB_COLUMNS_RESPONSE,
  tableName: "parcelas_replica",
};

/**
 * 3 rows in database:
 * - PAD-001: matches incoming file record
 * - PAD-002: has codigo='B2' (file has 'B2_MODIFIED', generating ATTRIBUTE_MISMATCH)
 * - PAD-003: only exists in DB (file does not have PAD-003, generating ONLY_IN_DB)
 */
export const DEFAULT_DB_ROWS = [
  {
    gid: 1,
    suid: "PAD-001",
    departamento: "MONTEVIDEO",
    codigo: "A1",
    geom: JSON.stringify({
      type: "Polygon",
      coordinates: [
        [
          [-56.1, -34.9],
          [-56.1, -34.8],
          [-56.0, -34.8],
          [-56.0, -34.9],
          [-56.1, -34.9],
        ],
      ],
    }),
  },
  {
    gid: 2,
    suid: "PAD-002",
    departamento: "CANELONES",
    codigo: "B2",
    geom: JSON.stringify({
      type: "Polygon",
      coordinates: [
        [
          [-56.2, -34.9],
          [-56.2, -34.8],
          [-56.1, -34.8],
          [-56.1, -34.9],
          [-56.2, -34.9],
        ],
      ],
    }),
  },
  {
    gid: 3,
    suid: "PAD-003",
    departamento: "ROCHA",
    codigo: "C3",
    geom: null,
  },
];

export const DEFAULT_STREAM_META = {
  type: "META",
  totalCount: 3,
  columnTypes: {
    gid: "integer",
    suid: "character varying(50)",
    departamento: "character varying(50)",
    codigo: "character varying(20)",
    geom: "geometry(MultiPolygon,4326)",
  },
  detectedSrid: 4326,
};

export const DEFAULT_STREAM_CHUNK = {
  type: "CHUNK",
  current: 3,
  total: 3,
  rows: DEFAULT_DB_ROWS,
};

export const DEFAULT_STREAM_DONE = {
  type: "DONE",
};

export function buildNdjsonStream(
  meta = DEFAULT_STREAM_META,
  chunk = DEFAULT_STREAM_CHUNK
): string {
  return [
    JSON.stringify(meta),
    JSON.stringify(chunk),
    JSON.stringify(DEFAULT_STREAM_DONE),
  ].join("\n") + "\n";
}

export const DEFAULT_EXECUTE_RESPONSE = {
  success: true,
  affectedRows: 2,
  message: "Ejecución exitosa en la base de datos sig_db. Registros modificados/insertados: 2.",
};

export const DEFAULT_TEST_RESPONSE = {
  success: true,
  message: "Conexión exitosa a PostgreSQL (sig_db en localhost:5432)",
};
