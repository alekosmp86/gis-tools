import type { DerivedColumn, MappedValue } from "../types";

const EDIFICIO_PROPERTY = "EDIFICIO";
const CODIGO_AREA_PROPERTY = "CODIGO_AREA";
const CENTRAL_NOMBRE_PROPERTY = "CENTRAL_NOMBRE";

const EDIFICIO_LENGTH = 10;
const CABLE_START = 1;
const CABLE_END = 4;
const ZONA_START = 5;
const ZONA_END = 7;
const CONCA_CABLE_START = 1;
const CONCA_CABLE_LENGTH = 2;
const CENTRAL_SUFFIX = " FTTH";
const CENTRAL_SUFFIX_REPLACEMENT = "C";
const CONCA_ZONA_PREFIX = "ZONA ";

function readText(properties: Readonly<Record<string, unknown>>, name: string): string | null {
  const value = properties[name];
  return typeof value === "string" ? value : null;
}

function sliceOrNull(text: string | null, start: number, end: number): string | null {
  return text === null ? null : text.substring(start, end);
}

function asText(value: MappedValue | undefined): string | null {
  return typeof value === "string" ? value : null;
}

export function buildConca(centralName: string | null, cable: string | null, zona: string | null): string {
  const central = (centralName ?? "").replace(CENTRAL_SUFFIX, CENTRAL_SUFFIX_REPLACEMENT);
  const cablePart = (cable ?? "").substring(CONCA_CABLE_START, CONCA_CABLE_START + CONCA_CABLE_LENGTH);
  return `${central}${cablePart}${CONCA_ZONA_PREFIX}${zona ?? ""}`;
}

export const ZONAS_FTTH_DERIVED_COLUMNS: ReadonlyArray<DerivedColumn> = [
  {
    column: "edificio",
    derive: (properties) => sliceOrNull(readText(properties, EDIFICIO_PROPERTY), 0, EDIFICIO_LENGTH),
  },
  {
    column: "cable",
    derive: (properties) => sliceOrNull(readText(properties, CODIGO_AREA_PROPERTY), CABLE_START, CABLE_END),
  },
  {
    column: "zona",
    derive: (properties) => sliceOrNull(readText(properties, CODIGO_AREA_PROPERTY), ZONA_START, ZONA_END),
  },
  {
    column: "conca",
    derive: (properties, values) =>
      buildConca(readText(properties, CENTRAL_NOMBRE_PROPERTY), asText(values.cable), asText(values.zona)),
  },
];
