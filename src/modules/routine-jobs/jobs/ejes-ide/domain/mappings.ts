import { literal, q } from "../../shared/sqlFragments";
import { FUENTE_IDS, TIPO_VIALIDAD_IDS } from "../constants";

export const roadSectionTypeIdOf = (tipoVialidad: string): number | undefined => TIPO_VIALIDAD_IDS[tipoVialidad];

export const fontIdOf = (fuente: string): number | undefined => FUENTE_IDS[fuente];

function mappingCte(name: string, ids: Readonly<Record<string, number>>): string {
  const rows = Object.entries(ids).map(([label, id]) => `(${literal(label)}, ${id})`);
  return `${q(name)}(label, id) AS (VALUES ${rows.join(", ")})`;
}

export const TIPO_MAP_CTE_NAME = "tipo_map";
export const FUENTE_MAP_CTE_NAME = "fuente_map";

export const tipoMapCte = (): string => mappingCte(TIPO_MAP_CTE_NAME, TIPO_VIALIDAD_IDS);

export const fuenteMapCte = (): string => mappingCte(FUENTE_MAP_CTE_NAME, FUENTE_IDS);
