import { ZONES } from "../../constants";

/**
 * Pieces of SQL shared by several statements. The zone key is the legacy one: the staging
 * `edificio|C0cable|Zzona` against the zones layer's `edificio|` + `codigo_distrito` with its `Z`
 * turned into `|Z`. Alias `zu` is the zones layer everywhere.
 */
export const ZONE_LAYER_KEY = `zu.edificio || '|' || REPLACE(zu.codigo_distrito, 'Z', '|Z')`;

export function stagingKey(alias: string): string {
  return `trim(${alias}.edificio) || '|C0' || trim(${alias}.cable) || '|Z' || trim(${alias}.zona)`;
}

/** Join condition of a staging table (alias `s`) to the zones layer. */
const STAGING_ZONE_JOIN = `${stagingKey("s")} = ${ZONE_LAYER_KEY}`;

/** The Avance table (alias `av`) already stores `'0' || trim(cable)`, so its key carries a single `C`. */
export const AVANCE_ZONE_JOIN = `trim(av.edificio) || '|C' || trim(av.cable) || '|Z' || trim(av.zona) = ${ZONE_LAYER_KEY}`;

/** The legacy SELECT list of the rebuild; the PostGIS expression stays here, in one reviewable place. */
export const REBUILD_COLUMNS = [
  "s.central",
  "'0' || trim(s.cable)",
  "s.zona",
  "s.conca",
  "s.edificio",
  "s.empresa",
  "s.plano_al_com",
  "s.director",
  "s.ejecutor",
  "s.etiqueta",
  "ST_Multi(zu.geom)",
].join(", ");

/** Parameter $1 is the list of district statuses the rebuild leaves out (decision O1). */
export function rebuildSource(stagingTable: string): string {
  return `FROM ${stagingTable} s
INNER JOIN ${ZONES} zu ON ${STAGING_ZONE_JOIN}
WHERE zu.situacion_distrito <> ALL($1::text[])`;
}
