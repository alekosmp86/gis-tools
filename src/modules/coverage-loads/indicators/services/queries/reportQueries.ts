import { HISTORY_TABLE, ReportKind } from "../../constants";

/**
 * The legacy report queries, verbatim except that `fecha_novedad` leaves the database already
 * formatted (`to_char`), so no date crosses a JS `Date`.
 */
const LOCALIDAD_SQL = `
SELECT h.nombdepto AS departamento, h.nombloc AS localidad,
       h.porcentajecobertura::numeric(5,2) AS porcentajecobertura,
       to_char(h.fechaact, 'DD-MM-YYYY') AS fecha_novedad
FROM ${HISTORY_TABLE} h
WHERE h.fechaact IN (SELECT h1.fechaact FROM ${HISTORY_TABLE} h1 ORDER BY h1.fechaact DESC LIMIT 1)
ORDER BY h.nombdepto, h.nombloc
`;

const MAYOR50_SQL = `
SELECT a.departamento, a.localidad, a.porcentajecobertura, to_char(a.fecha_novedad, 'DD-MM-YYYY') AS fecha_novedad
FROM (SELECT h.nombdepto AS departamento, h.nombloc AS localidad,
             h.porcentajecobertura::numeric(5,2) AS porcentajecobertura, h.cobertura_lte, h.fechaact AS fecha_novedad
      FROM ${HISTORY_TABLE} h
      WHERE h.fechaact IN (SELECT h1.fechaact FROM ${HISTORY_TABLE} h1 ORDER BY h1.fechaact DESC LIMIT 1)
      ORDER BY h.nombdepto, h.nombloc) a
WHERE a.porcentajecobertura > 49.99 AND a.cobertura_lte::text = 'SI'::text
ORDER BY a.departamento, a.localidad
`;

/** Keeps `now()` (not the cut date) and no outer ORDER BY, exactly as the legacy query. */
const NOVEDAD_SQL = `
SELECT DISTINCT ON ((a.nombdepto::text || '|'::text) || a.nombloc::text)
       a.nombdepto AS departamento, a.nombloc AS localidad,
       a.porcentajecobertura::numeric(5,2) AS porcentajecobertura,
       to_char(a.fecha_novedad, 'DD-MM-YYYY') AS fecha_novedad
FROM (SELECT h.nombdepto, h.nombloc, h.arealoclte, h.porcentajecobertura, h.cobertura_lte, h.fechaact AS fecha_novedad
      FROM ${HISTORY_TABLE} h
      WHERE h.fechaact > (now() - '3 mons'::interval)
        AND h.porcentajecobertura::double precision >= 50::double precision
        AND h.cobertura_lte::text = 'SI'::text
        AND NOT ((h.nombdepto::text || '|'::text) || h.nombloc::text IN
             (SELECT DISTINCT ON ((h1.nombdepto::text || '|'::text) || h1.nombloc::text)
                     (h1.nombdepto::text || '|'::text) || h1.nombloc::text
              FROM ${HISTORY_TABLE} h1
              WHERE h1.fechaact < (now() - '3 mons'::interval)
                AND h1.porcentajecobertura::double precision >= 50::double precision))
      ORDER BY h.nombdepto, h.nombloc, h.fechaact) a
`;

export const REPORT_SQL: Readonly<Record<ReportKind, string>> = {
  [ReportKind.LOCALIDAD]: LOCALIDAD_SQL,
  [ReportKind.MAYOR50]: MAYOR50_SQL,
  [ReportKind.NOVEDAD]: NOVEDAD_SQL,
};
