import {
  AVANCE,
  CENTRAL_LIMITS,
  EXCLUDED_DISTRICT_STATUSES,
  EXCLUDED_ZONE_NAMES,
  HISTORY,
  ReportKind,
  SQL_DATE_FORMAT,
  STAGING_INT,
  STAGING_UDPEM,
  ZONES,
} from "../../constants";
import { ZONE_LAYER_KEY, stagingKey } from "./sqlFragments";

/**
 * The five legacy report queries, ported in meaning. Differences, all deliberate: tables come from
 * the constants and are qualified; dates leave as text (`to_char`); the `Proyectado/Eliminación`
 * literal (mojibake in the legacy files) is the bound list of decision O1; `zona NOT LIKE 'DO' AND
 * ...` is `zona <> ALL(list)`; the legacy `LEFT JOIN ... WHERE zu.situacion_distrito <> x` that
 * behaved as an inner join is written as one, so an empty exclusion list keeps its meaning. The two
 * `NOT IN (subquery)` reports are anti-joins over a WITH set (Postgres plans NOT IN as a rescanning
 * SubPlan), keeping the NOT IN NULL semantics; no MATERIALIZED, the target may be Postgres 11.
 */

export interface ReportQuery {
  readonly sql: string;
  readonly params: ReadonlyArray<unknown>;
}

const DATE_TEXT = (expression: string, alias: string): string =>
  `to_char(${expression}, '${SQL_DATE_FORMAT}') AS ${alias}`;

const planillaZones = (table: string, zoneNamesParam: string): string => `
  SELECT edificio, cable, zona, conca, etiqueta
  FROM ${table}
  WHERE zona <> ALL(${zoneNamesParam}::text[])
  GROUP BY edificio, cable, zona, conca, etiqueta`;

const bothPlanillas = (zoneNamesParam: string): string => `${planillaZones(STAGING_INT, zoneNamesParam)}
  UNION ALL ${planillaZones(STAGING_UDPEM, zoneNamesParam)}`;

const DUPLICADO_SQL = `
SELECT a.central, a.cable, a.zona, a.empresa, a.plano_al_com, a.ejecutor, a.director,
       a.etiqueta, a.conca, a.edificio, a.fechaact, a.fuente, ${DATE_TEXT("a.fechacarga", "fechacarga")}
FROM ${STAGING_INT} a
INNER JOIN (SELECT edificio, cable, zona FROM ${STAGING_INT} WHERE zona <> ALL($1::text[])
            GROUP BY edificio, cable, zona HAVING count(*) > 1) b
  ON a.edificio = b.edificio AND a.cable = b.cable AND a.zona = b.zona
UNION ALL
SELECT c.central, c.cable, c.zona, c.empresa, c.plano_al_com, c.ejecutor, c.director,
       c.etiqueta, c.conca, c.edificio, c.fechaact, c.fuente, ${DATE_TEXT("c.fechacarga", "fechacarga")}
FROM ${STAGING_UDPEM} c
INNER JOIN (SELECT edificio, cable, zona FROM ${STAGING_UDPEM} WHERE zona <> ALL($1::text[])
            GROUP BY edificio, cable, zona HAVING count(*) > 1) d
  ON c.edificio = d.edificio AND c.cable = d.cable AND c.zona = d.zona
ORDER BY 9, 2, 3, 8
`;

const ERROR_ESTADOS_SQL = `
SELECT av.edificio, b.edificio AS historico_edificio,
       av.cable, b.cable AS historico_cable,
       av.zona, b.zona AS historico_zona,
       av.estado, b.estado AS historico_estado,
       av.empresa, b.empresa AS historico_empresa,
       av.fecha, b.fecha AS historico_fecha,
       av.director, b.director AS historico_director,
       av.ejecutor, b.ejecutor AS historico_ejecutor,
       ${DATE_TEXT("b.fechacarga", "historico_fechacarga")}
FROM ${AVANCE} av
RIGHT JOIN (SELECT h.edificio, h.cable, h.zona, h.empresa, h.fecha, h.director, h.ejecutor, h.estado, h.fechacarga
            FROM ${HISTORY} h
            INNER JOIN (SELECT fh.fechacarga FROM ${HISTORY} fh GROUP BY fh.fechacarga
                        ORDER BY fh.fechacarga DESC LIMIT 1) latest
              ON h.fechacarga = latest.fechacarga) b
  ON av.cable = b.cable AND av.zona = b.zona AND av.edificio = b.edificio
WHERE CASE WHEN UPPER(av.estado) = UPPER(b.estado) THEN 'OK' ELSE 'ERROR' END = 'ERROR'
  AND (UPPER(b.estado) = 'EJECUTADA'
    OR UPPER(b.estado) = 'EJECUTADA SIN PLANOSALCOM'
       AND (av.estado <> 'EJECUTADA' AND av.estado <> 'EJECUTADA SIN PLANOSALCOM')
    OR UPPER(b.estado) = 'EN TRABAJO'
       AND (UPPER(av.estado) <> 'EJECUTADA' AND UPPER(av.estado) <> 'EJECUTADA SIN PLANOSALCOM'
            AND UPPER(av.estado) <> 'EN TRABAJO')
    OR UPPER(b.estado) = 'PLAN 2017'
       AND (UPPER(av.estado) <> 'PLAN 2017' AND UPPER(av.estado) <> 'EJECUTADA'
            AND UPPER(av.estado) <> 'EJECUTADA SIN PLANOSALCOM' AND UPPER(av.estado) <> 'EN TRABAJO'))
ORDER BY av.edificio, av.cable, av.zona
`;

/**
 * `<leftKey> NOT IN (matched)` rewritten as an anti-join with the same NULL semantics: a NULL left key
 * is returned only when the matched set is empty, and a NULL in the matched set blanks the report.
 */
const antiJoinOn = (leftKey: string): string => `(${leftKey} IS NOT NULL OR NOT EXISTS (SELECT 1 FROM matched))
  AND NOT EXISTS (SELECT 1 FROM matched m WHERE m.match_key = ${leftKey})
  AND NOT EXISTS (SELECT 1 FROM matched WHERE match_key IS NULL)`;

const PLANILLA_LEFT_KEY = "b.edificio || '|' || b.cable || '|' || b.zona";

const EN_PLANILLA_NO_EN_SIGRA_SQL = `
WITH matched AS (
  SELECT a.edificio || '|' || a.cable || '|' || a.zona AS match_key
  FROM (${bothPlanillas("$1")}) a
  INNER JOIN ${ZONES} zu ON ${stagingKey("a")} = ${ZONE_LAYER_KEY}
  WHERE zu.situacion_distrito <> ALL($2::text[]))
SELECT b.* FROM (${bothPlanillas("$1")}) b
WHERE ${antiJoinOn(PLANILLA_LEFT_KEY)}
ORDER BY b.edificio, b.cable, b.zona
`;

const SIGRA_KEY = (alias: string): string =>
  `${alias}.edificio || '|' || SUBSTR(${alias}.codigo_distrito, 1, 4) || '|' || SUBSTR(${alias}.codigo_distrito, 5, 3)`;

const EN_SIGRA_NO_EN_PLANILLA_SQL = `
WITH matched AS (
  SELECT ${SIGRA_KEY("b")} AS match_key
  FROM ${ZONES} b
  INNER JOIN (${bothPlanillas("$2")}) a
    ON trim(a.edificio) || '|C0' || trim(a.cable) || '|Z' || trim(a.zona) = ${SIGRA_KEY("b")}
  WHERE b.situacion_distrito <> ALL($1::text[]))
SELECT c.id_distrito, c.edificio, c.identificacion_de_la_central, c.codigo_distrito,
       c.nombre_central, c.cable, c.zona, c.conca, c.situacion_distrito, c.id_terminalfibraoptica,
       c.codigo_terminalfibraoptica
FROM ${ZONES} c
WHERE ${antiJoinOn(SIGRA_KEY("c"))}
  AND c.situacion_distrito <> ALL($1::text[])
ORDER BY ${SIGRA_KEY("c")}
`;

/** The slowest: every avance polygon is intersected with the central limits. */
const FUERA_CENTRAL_SQL = `
SELECT a.gid, a.central, a.cable, a.zona, a.conca, a.edificio, a.fecha, a.estado,
       ${DATE_TEXT("date(a.fechacarga)", "fechacarga")}
FROM ${AVANCE} a
LEFT JOIN ${CENTRAL_LIMITS} lc ON st_intersects(a.geom, lc.geom)
GROUP BY a.gid, a.central, a.cable, a.zona, a.conca, a.edificio, a.fecha, a.estado, a.fechacarga
HAVING (sum(st_area(st_intersection(a.geom, lc.geom))) / st_area(a.geom) * 100::double precision) < 90::double precision
UNION ALL
SELECT a.gid, a.central, a.cable, a.zona, a.conca, a.edificio, a.fecha, a.estado,
       ${DATE_TEXT("date(a.fechacarga)", "fechacarga")}
FROM ${AVANCE} a
LEFT JOIN ${CENTRAL_LIMITS} lc ON st_intersects(a.geom, lc.geom)
WHERE lc.geom IS NULL
ORDER BY 5
`;

export const REPORT_QUERIES: Readonly<Record<ReportKind, ReportQuery>> = {
  [ReportKind.DUPLICADO]: { sql: DUPLICADO_SQL, params: [EXCLUDED_ZONE_NAMES] },
  [ReportKind.ERROR_ESTADOS]: { sql: ERROR_ESTADOS_SQL, params: [] },
  [ReportKind.EN_PLANILLA_NO_EN_SIGRA]: {
    sql: EN_PLANILLA_NO_EN_SIGRA_SQL,
    params: [EXCLUDED_ZONE_NAMES, EXCLUDED_DISTRICT_STATUSES],
  },
  [ReportKind.EN_SIGRA_NO_EN_PLANILLA]: {
    sql: EN_SIGRA_NO_EN_PLANILLA_SQL,
    params: [EXCLUDED_DISTRICT_STATUSES, EXCLUDED_ZONE_NAMES],
  },
  [ReportKind.FUERA_CENTRAL]: { sql: FUERA_CENTRAL_SQL, params: [] },
};
