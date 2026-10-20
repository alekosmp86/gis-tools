import type { MockBackendOptions } from "../support/mockBackend";
import {
  buildChunk,
  buildColumnsResponse,
  buildNdjsonStream,
  type ColumnSpec,
} from "./db-db-sync.mocks";

export const CSV_FILE_NAME = "parcelas_actualizadas.csv";

const PARCEL_SIDE = 0.003;
const ENLARGED_PARCEL_SIDE = 0.0045;

interface ParcelSeed {
  padron: string;
  localidad: string;
  area_m2: string;
  uso_suelo: string;
  west: number;
  south: number;
  side?: number;
}

export interface ParcelRow {
  padron: string;
  departamento: string;
  localidad: string;
  area_m2: string;
  uso_suelo: string;
  geometry: Array<[number, number]>;
}

function buildSquare({ west, south, side = PARCEL_SIDE }: ParcelSeed): Array<[number, number]> {
  const east = west + side;
  const north = south + side;
  return [
    [west, south],
    [west, north],
    [east, north],
    [east, south],
    [west, south],
  ];
}

function buildParcel(seed: ParcelSeed): ParcelRow {
  return {
    padron: seed.padron,
    departamento: "Montevideo",
    localidad: seed.localidad,
    area_m2: seed.area_m2,
    uso_suelo: seed.uso_suelo,
    geometry: buildSquare(seed),
  };
}

const DB_PARCELS: ParcelRow[] = [
  { padron: "10234", localidad: "Pocitos", area_m2: "412.50", uso_suelo: "Residencial", west: -56.17, south: -34.91 },
  { padron: "10235", localidad: "Pocitos", area_m2: "380.00", uso_suelo: "Comercial", west: -56.165, south: -34.91 },
  { padron: "10236", localidad: "Cordón", area_m2: "298.40", uso_suelo: "Residencial", west: -56.16, south: -34.91 },
  { padron: "10237", localidad: "Cordón", area_m2: "305.10", uso_suelo: "Residencial", west: -56.155, south: -34.91 },
  { padron: "10238", localidad: "Malvín", area_m2: "455.30", uso_suelo: "Residencial", west: -56.17, south: -34.9 },
  { padron: "10239", localidad: "Malvín", area_m2: "520.00", uso_suelo: "Comercial", west: -56.162, south: -34.9 },
  { padron: "10240", localidad: "Centro", area_m2: "610.00", uso_suelo: "Comercial", west: -56.154, south: -34.9 },
].map(buildParcel);

export const CSV_PARCELS: ParcelRow[] = [
  { padron: "10234", localidad: "Pocitos", area_m2: "412.50", uso_suelo: "Residencial", west: -56.17, south: -34.91 },
  { padron: "10235", localidad: "Pocitos", area_m2: "380.00", uso_suelo: "Mixto", west: -56.165, south: -34.91 },
  { padron: "10236", localidad: "Cordón", area_m2: "298.40", uso_suelo: "Residencial", west: -56.16, south: -34.91 },
  { padron: "10237", localidad: "Cordón", area_m2: "312.60", uso_suelo: "Residencial", west: -56.155, south: -34.91 },
  { padron: "10238", localidad: "Malvín", area_m2: "455.30", uso_suelo: "Residencial", west: -56.17, south: -34.9, side: ENLARGED_PARCEL_SIDE },
  { padron: "10239", localidad: "Malvín", area_m2: "520.00", uso_suelo: "Comercial", west: -56.162, south: -34.9 },
  { padron: "10241", localidad: "Carrasco", area_m2: "720.00", uso_suelo: "Residencial", west: -56.146, south: -34.905 },
].map(buildParcel);

function toWkt(ring: Array<[number, number]>): string {
  const coordinates = ring.map(([longitude, latitude]) => `${longitude} ${latitude}`).join(", ");
  return `POLYGON((${coordinates}))`;
}

function toGeoJsonText(ring: Array<[number, number]>): string {
  return JSON.stringify({ type: "Polygon", coordinates: [ring] });
}

export const CSV_CONTENT = [
  "padron,departamento,localidad,area_m2,uso_suelo,geom",
  ...CSV_PARCELS.map(
    (parcel) =>
      `${parcel.padron},${parcel.departamento},${parcel.localidad},${parcel.area_m2},${parcel.uso_suelo},"${toWkt(parcel.geometry)}"`
  ),
].join("\n") + "\n";

const DB_COLUMN_SPECS: ColumnSpec[] = [
  { name: "gid", type: "integer", nullable: false, defaultValue: "nextval('parcelas_gid_seq'::regclass)", primaryKey: true },
  { name: "padron", type: "character varying(20)", nullable: false },
  { name: "departamento", type: "character varying(50)" },
  { name: "localidad", type: "character varying(80)" },
  { name: "area_m2", type: "numeric(12,2)" },
  { name: "uso_suelo", type: "character varying(40)" },
  { name: "geom", type: "geometry(Polygon,4326)" },
];

const COLUMN_TYPES = Object.fromEntries(DB_COLUMN_SPECS.map((spec) => [spec.name, spec.type]));

const DB_ROWS = DB_PARCELS.map((parcel, index) => ({
  gid: index + 1,
  padron: parcel.padron,
  departamento: parcel.departamento,
  localidad: parcel.localidad,
  area_m2: parcel.area_m2,
  uso_suelo: parcel.uso_suelo,
  geom: toGeoJsonText(parcel.geometry),
}));

const DB_META = { type: "META", totalCount: DB_ROWS.length, columnTypes: COLUMN_TYPES, detectedSrid: 4326 };

export const CSV_CONNECTED_MOCKS: MockBackendOptions = {
  columns: buildColumnsResponse("parcelas", DB_ROWS.length, DB_COLUMN_SPECS),
  recordsStream: buildNdjsonStream(DB_META, buildChunk(DB_ROWS)),
  execute: { success: true, affectedRows: 5, message: "Ejecución exitosa." },
};
