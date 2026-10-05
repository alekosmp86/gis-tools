import { Decision, REMOVE_REASONS } from "../../constants";
import { RemovalBlockReason, RemovalTable } from "../../removalConstants";
import { DUPLICATE_ANALYSIS_SQL } from "./duplicateAnalysisQuery";

const ANALYSIS_BODY_SQL = DUPLICATE_ANALYSIS_SQL.trim().replace(/;$/, "");
const REMOVE_REASON_SQL_LIST = REMOVE_REASONS.map((reason) => `'${reason}'`).join(", ");

/**
 * Resolves the removal targets from a fresh run of the analysis query, in one statement.
 *
 * The target set is derived here and nowhere else: a urn qualifies only when EVERY analysis row
 * carrying it is `decision = REMOVE` on a removable fuente. `HAS_INTERNAL_UNITS` and
 * `KEPT_ALONGSIDE_PROTECTED` rows are KEEP in the analysis, so they never enter `targets`;
 * `has_foreign_reason` re-checks that each target carries one of the REMOVE reasons.
 *
 * Per target it then applies the integrity guards of `carto.baja_direccion_base_v1` (one
 * address + master + urn, master not shared, a door with no internal units) and returns the
 * snapshot whose md5 is the fingerprint, plus the sorted `target_list` of the same `targets`
 * CTE that `target_count` counts. Ids leave as text so a bigint beyond 2^53 survives the JSON. Parameters `$1`..`$8` are the analysis query's.
 * Literals interpolated below are module constants, never request data.
 */
export const REMOVAL_PLAN_SQL = `
WITH analysis AS (
${ANALYSIS_BODY_SQL}
),
targets AS (
  SELECT coalesce(urn, '') AS urn,
         min(fuente) AS fuente,
         bool_or(decision_reason <> ALL(ARRAY[${REMOVE_REASON_SQL_LIST}]::text[])) AS has_foreign_reason
  FROM analysis
  GROUP BY coalesce(urn, '')
  HAVING bool_and(decision = '${Decision.REMOVE}' AND fuente = ANY($3::text[]))
),
resolved AS (
  SELECT t.urn, t.fuente, m.addresses_master_id AS master_id, a.id AS address_id
  FROM targets t
  LEFT JOIN carto.addresses_master m ON m.urn = t.urn
  LEFT JOIN carto.address a ON a.id_address_master = m.addresses_master_id
),
verdicts AS (
  SELECT r.urn,
         count(DISTINCT r.master_id) AS master_count,
         count(DISTINCT r.address_id) AS address_count,
         coalesce(array_agg(DISTINCT r.master_id) FILTER (WHERE r.master_id IS NOT NULL), '{}') AS master_ids,
         bool_or(EXISTS (SELECT 1 FROM carto.address other
                         WHERE other.id_address_master = r.master_id AND other.id <> r.address_id)) AS master_shared,
         bool_or(r.address_id IS NOT NULL
                 AND NOT EXISTS (SELECT 1 FROM carto.access_point ap WHERE ap.id = r.address_id)) AS not_a_door,
         bool_or(EXISTS (SELECT 1 FROM carto.internal_address ia WHERE ia.id = r.address_id)) AS is_internal,
         bool_or(EXISTS (SELECT 1 FROM carto.internal_address_access_point iaap
                         WHERE iaap.id_access_point = r.address_id)) AS has_internal_units,
         bool_or(EXISTS (SELECT 1 FROM carto.internal_address_access_point iaap
                         WHERE iaap.id_internal_address = r.address_id)) AS linked_as_internal
  FROM resolved r
  GROUP BY r.urn
),
verdict_reasons AS (
  SELECT v.urn, v.master_ids,
         array_remove(ARRAY[
           CASE WHEN btrim(v.urn) = '' THEN '${RemovalBlockReason.URN_BLANK}' END,
           CASE WHEN btrim(v.urn) <> '' AND (v.master_count = 0 OR v.address_count = 0)
                THEN '${RemovalBlockReason.URN_NOT_FOUND}' END,
           CASE WHEN v.master_count > 1 OR v.address_count > 1 THEN '${RemovalBlockReason.URN_AMBIGUOUS}' END,
           CASE WHEN v.master_shared THEN '${RemovalBlockReason.MASTER_SHARED}' END,
           CASE WHEN v.not_a_door THEN '${RemovalBlockReason.NOT_A_DOOR}' END,
           CASE WHEN v.is_internal THEN '${RemovalBlockReason.IS_INTERNAL}' END,
           CASE WHEN v.has_internal_units THEN '${RemovalBlockReason.HAS_INTERNAL_UNITS}' END,
           CASE WHEN v.linked_as_internal THEN '${RemovalBlockReason.LINKED_AS_INTERNAL}' END
         ], NULL) AS reasons
  FROM verdicts v
),
scope AS (
  SELECT coalesce(array_agg(DISTINCT address_id) FILTER (WHERE address_id IS NOT NULL), '{}') AS address_ids,
         coalesce(array_agg(DISTINCT master_id) FILTER (WHERE master_id IS NOT NULL), '{}') AS master_ids,
         coalesce(array_agg(DISTINCT urn), '{}') AS urns
  FROM resolved
  WHERE btrim(urn) <> ''
),
snapshot_doc AS (
  SELECT jsonb_build_object(
           'version', 1,
           'direcciones', coalesce((
             SELECT jsonb_agg(jsonb_build_object('address', to_jsonb(a), 'master', to_jsonb(m),
                                                 'puerta', to_jsonb(ap), 'interna', to_jsonb(i)) ORDER BY a.id)
             FROM carto.address a
             JOIN carto.addresses_master m ON m.addresses_master_id = a.id_address_master
             LEFT JOIN carto.access_point ap ON ap.id = a.id
             LEFT JOIN carto.internal_address i ON i.id = a.id
             WHERE a.id = ANY(s.address_ids)), '[]'::jsonb),
           'incluir_internas', false,
           'relaciones_internas', coalesce((
             SELECT jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text)
             FROM carto.internal_address_access_point r
             WHERE r.id_internal_address = ANY(s.address_ids)), '[]'::jsonb),
           'territorios', coalesce((
             SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)
             FROM carto.territorial_unit_access_point t
             WHERE t.id_access_point = ANY(s.address_ids)), '[]'::jsonb),
           'compactas', coalesce((
             SELECT jsonb_agg(to_jsonb(c) ORDER BY to_jsonb(c)::text)
             FROM carto.compact_address c
             WHERE c.urn = ANY(s.urns)), '[]'::jsonb)
         ) AS doc
  FROM scope s
)
SELECT (SELECT count(*)::int FROM targets) AS target_count,
       (SELECT count(*)::int FROM targets WHERE has_foreign_reason) AS out_of_scope_count,
       coalesce((SELECT jsonb_object_agg(fuente_name, fuente_count)
                 FROM (SELECT coalesce(fuente, '') AS fuente_name, count(*)::int AS fuente_count
                       FROM targets GROUP BY 1) by_fuente), '{}'::jsonb) AS by_fuente,
       jsonb_build_object(
         '${RemovalTable.INTERNAL_ADDRESS_ACCESS_POINT}',
           (SELECT count(*)::int FROM carto.internal_address_access_point WHERE id_internal_address = ANY(s.address_ids)),
         '${RemovalTable.TERRITORIAL_UNIT_ACCESS_POINT}',
           (SELECT count(*)::int FROM carto.territorial_unit_access_point WHERE id_access_point = ANY(s.address_ids)),
         '${RemovalTable.COMPACT_ADDRESS}',
           (SELECT count(*)::int FROM carto.compact_address WHERE urn = ANY(s.urns)),
         '${RemovalTable.INTERNAL_ADDRESS}',
           (SELECT count(*)::int FROM carto.internal_address WHERE id = ANY(s.address_ids)),
         '${RemovalTable.ACCESS_POINT}',
           (SELECT count(*)::int FROM carto.access_point WHERE id = ANY(s.address_ids)),
         '${RemovalTable.ADDRESS}',
           (SELECT count(*)::int FROM carto.address WHERE id = ANY(s.address_ids)),
         '${RemovalTable.ADDRESSES_MASTER}',
           (SELECT count(*)::int FROM carto.addresses_master WHERE addresses_master_id = ANY(s.master_ids))
       ) AS rows_by_table,
       coalesce((SELECT jsonb_agg(jsonb_build_object('urn', urn, 'masterIds', to_jsonb(master_ids::text[]),
                                                     'reasons', to_jsonb(reasons)) ORDER BY urn)
                 FROM verdict_reasons), '[]'::jsonb) AS verdicts,
       coalesce((SELECT jsonb_agg(jsonb_build_object('urn', urn, 'fuente', coalesce(fuente, '')) ORDER BY urn COLLATE "C")
                 FROM targets), '[]'::jsonb) AS target_list,
       to_jsonb(s.address_ids::text[]) AS address_ids,
       to_jsonb(s.master_ids::text[]) AS master_ids,
       to_jsonb(s.urns) AS urns,
       d.doc AS snapshot,
       md5(d.doc::text) AS fingerprint
FROM scope s
CROSS JOIN snapshot_doc d;
`;
