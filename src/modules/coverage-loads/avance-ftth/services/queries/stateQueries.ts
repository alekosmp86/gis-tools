import { AVANCE, AvanceFileKind, HISTORY, STAGING_INT, STAGING_UDPEM, ZONES } from "../../constants";
import { AVANCE_ZONE_JOIN } from "./sqlFragments";

/** Dates leave the database as text (`to_char`): no JS `Date` ever touches them. */

export const STAGING_STATE_SQL: Readonly<Record<AvanceFileKind, string>> = {
  [AvanceFileKind.INT]: `SELECT count(*)::int AS total, min(fechaact) AS fechaact FROM ${STAGING_INT}`,
  [AvanceFileKind.UDPEM]: `SELECT count(*)::int AS total, min(fechaact) AS fechaact FROM ${STAGING_UDPEM}`,
};

/** `loaded_today` uses the database's own `current_date`; it is the whole of decision O2. */
export const AVANCE_STATE_SQL = `
SELECT count(*)::int AS total,
       to_char(min(fechacarga), 'YYYY-MM-DD') AS oldest_load,
       to_char(max(fechacarga), 'YYYY-MM-DD') AS newest_load,
       (count(*) > 0 AND count(*) = count(*) FILTER (WHERE fechacarga = current_date)) AS loaded_today
FROM ${AVANCE}
`;

export const HISTORY_COUNT_SQL = `SELECT count(*)::int AS total FROM ${HISTORY}`;

export const ZONES_COUNT_SQL = `SELECT count(*)::int AS total FROM ${ZONES}`;

export const ZONE_STATUS_SQL = `
SELECT COALESCE(situacion_distrito, '') AS status, count(*)::int AS total
FROM ${ZONES}
GROUP BY 1
ORDER BY 1
`;

export const AVANCE_BY_STATUS_SQL = `
SELECT COALESCE(zu.situacion_distrito, '') AS status, count(*)::int AS total
FROM ${AVANCE} av
INNER JOIN ${ZONES} zu ON ${AVANCE_ZONE_JOIN}
GROUP BY 1
ORDER BY 1
`;

/** NULL when the table or its serial column does not exist: the caller treats that as undetermined. */
export const SEQUENCE_USAGE_SQL = `
SELECT CASE WHEN to_regclass($1::text) IS NULL THEN NULL
            ELSE has_sequence_privilege(pg_get_serial_sequence($1::text, $2::text), $3::text) END AS granted
`;
