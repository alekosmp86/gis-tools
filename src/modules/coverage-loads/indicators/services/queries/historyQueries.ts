import { HISTORY_TABLE, STAGING_TABLE } from "../../constants";

/** Dates are read as text (`to_char`) and bound as text: no JS `Date` ever touches them. */
export const EXISTING_ROWS_SQL = `
SELECT to_char(fechaact, 'YYYY-MM-DD') AS fechaact, count(*)::int AS total
FROM ${HISTORY_TABLE}
WHERE fechaact = ANY($1::text[]::date[])
GROUP BY fechaact
`;

export const STORED_ROWS_SQL = `
SELECT count(*)::int AS total
FROM ${HISTORY_TABLE}
WHERE fechaact = $1::text::date
`;

export const LOCK_STAGING_SQL = `LOCK TABLE ${STAGING_TABLE} IN SHARE ROW EXCLUSIVE MODE`;
export const DELETE_STAGING_SQL = `DELETE FROM ${STAGING_TABLE}`;

/** Parameters: fechaact[], fuente, nombloc[], nombdepto[], cobertura_lte[], porcentaje[]. */
export const INSERT_STAGING_SQL = `
INSERT INTO ${STAGING_TABLE} (fechaact, fuente, nombloc, nombdepto, cobertura_lte, porcentaje)
SELECT incoming.fechaact, $2::text, incoming.nombloc, incoming.nombdepto, incoming.cobertura_lte, incoming.porcentaje
FROM unnest($1::text[], $3::text[], $4::text[], $5::text[], $6::text[])
  AS incoming(fechaact, nombloc, nombdepto, cobertura_lte, porcentaje)
`;

/** The legacy statement 2, unchanged: replace every date present in staging, in one statement. */
export const REPLACE_HISTORY_SQL = `
WITH borrado AS (
  DELETE FROM ${HISTORY_TABLE}
  WHERE fechaact IN (SELECT DATE(il2.fechaact) FROM ${STAGING_TABLE} il2)
  RETURNING 1)
INSERT INTO ${HISTORY_TABLE}
  (nombdepto, nombloc, porcentajecobertura, cobertura_lte, fechaact, fecha_historico, usuario)
SELECT il.nombdepto, il.nombloc, ROUND(il.porcentaje::NUMERIC, 2), UPPER(il.cobertura_lte),
       to_date(il.fechaact, 'YYYY-mm-dd'), DATE('now'), il.fuente
FROM ${STAGING_TABLE} il
ORDER BY il.nombdepto, il.nombloc
`;
