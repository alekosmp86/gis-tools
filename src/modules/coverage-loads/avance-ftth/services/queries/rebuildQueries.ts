import { AVANCE, AvanceFileKind, HISTORY, STAGING_TABLE_BY_KIND, ZONES } from "../../constants";
import { REBUILD_COLUMNS, ZONE_LAYER_KEY, rebuildSource } from "./sqlFragments";

/**
 * The legacy `Planificacion_avance_ftth_update_bd.ktr`, statement by statement. Counts come out of
 * the statement itself (`WITH ... RETURNING 1`), so they are the rows the statement really wrote.
 * Staging statements exist once per kind; the Avance statements are the same for both.
 */

function perKind(build: (stagingTable: string) => string): Readonly<Record<AvanceFileKind, string>> {
  return {
    [AvanceFileKind.INT]: build(STAGING_TABLE_BY_KIND[AvanceFileKind.INT]),
    [AvanceFileKind.UDPEM]: build(STAGING_TABLE_BY_KIND[AvanceFileKind.UDPEM]),
  };
}

export const LOCK_STAGING_SQL = perKind((table) => `LOCK TABLE ${table} IN SHARE ROW EXCLUSIVE MODE`);
export const LOCK_AVANCE_SQL = `LOCK TABLE ${AVANCE} IN SHARE ROW EXCLUSIVE MODE`;
export const DELETE_STAGING_SQL = perKind((table) => `DELETE FROM ${table}`);
export const COUNT_STAGING_SQL = perKind((table) => `SELECT count(*)::int AS total FROM ${table}`);
export const COUNT_AVANCE_SQL = `SELECT count(*)::int AS total FROM ${AVANCE}`;

/** Parameters: the ten arrays in CSV order, then fechaact and fuente. */
export const INSERT_STAGING_SQL = perKind(
  (table) => `
INSERT INTO ${table} (central, cable, zona, empresa, plano_al_com, ejecutor, director, etiqueta, conca, edificio, fechaact, fuente)
SELECT incoming.central, incoming.cable, incoming.zona, incoming.empresa, incoming.plano_al_com, incoming.ejecutor,
       incoming.director, incoming.etiqueta, incoming.conca, incoming.edificio, $11::text, $12::text
FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[], $10::text[])
  AS incoming(central, cable, zona, empresa, plano_al_com, ejecutor, director, etiqueta, conca, edificio)
`
);

/** Parameter: the `LIKE` pattern of the junk `conca`. */
export const DELETE_JUNK_SQL = perKind(
  (table) => `
WITH deleted AS (DELETE FROM ${table} WHERE conca LIKE $1::text RETURNING 1)
SELECT count(*)::int AS total FROM deleted
`
);

/** The legacy statement: the old `fechacarga` is kept, `fecha_historico` takes its default. */
export const COPY_TO_HISTORY_SQL = `
WITH copied AS (
  INSERT INTO ${HISTORY} (central, cable, zona, conca, edificio, empresa, fecha, director, ejecutor, estado, fechacarga)
  SELECT aup.central, aup.cable, aup.zona, aup.conca, aup.edificio, aup.empresa, aup.fecha, aup.director,
         aup.ejecutor, aup.estado, aup.fechacarga
  FROM ${AVANCE} aup
  RETURNING 1)
SELECT count(*)::int AS total FROM copied
`;

export const DELETE_AVANCE_SQL = `DELETE FROM ${AVANCE}`;

/** Parameter $1: statuses to leave out. The GROUP BY collapses identical duplicate staging rows. */
export const INSERT_AVANCE_SQL = perKind(
  (table) => `
WITH inserted AS (
  INSERT INTO ${AVANCE} (central, cable, zona, conca, edificio, empresa, fecha, director, ejecutor, estado, geom)
  SELECT ${REBUILD_COLUMNS}
  ${rebuildSource(table)}
  GROUP BY ${REBUILD_COLUMNS}
  RETURNING 1)
SELECT count(*)::int AS total FROM inserted
`
);

/** Parameter: the new `fuente`. */
export const UPDATE_AVANCE_FUENTE_SQL = `UPDATE ${AVANCE} SET fuente = $1::text`;

/** The rows the insert will write, per district status: the same join, grouped, run before the insert. Parameter $1: statuses to leave out. */
export const BREAKDOWN_BY_STATUS_SQL = perKind(
  (table) => `
SELECT COALESCE(grouped.district_status, '') AS status, count(*)::int AS total
FROM (
  SELECT ${REBUILD_COLUMNS}, zu.situacion_distrito AS district_status
  ${rebuildSource(table)}
  GROUP BY ${REBUILD_COLUMNS}, zu.situacion_distrito) grouped
GROUP BY 1
ORDER BY 1
`
);

/** Parameters: $1 statuses to leave out, $2 zone names the legacy reports skip. */
export const COUNT_UNMATCHED_SQL = perKind(
  (table) => `
SELECT count(*)::int AS total
FROM (
  SELECT DISTINCT trim(s.edificio) AS edificio, trim(s.cable) AS cable, trim(s.zona) AS zona
  FROM ${table} s
  WHERE s.zona IS NULL OR s.zona <> ALL($2::text[])) keys
WHERE NOT EXISTS (
  SELECT 1 FROM ${ZONES} zu
  WHERE keys.edificio || '|C0' || keys.cable || '|Z' || keys.zona = ${ZONE_LAYER_KEY}
    AND zu.situacion_distrito <> ALL($1::text[]))
`
);
