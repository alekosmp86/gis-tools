import {
  Decision,
  DecisionReason,
  DedupScope,
  DOCUMENT_TYPE_PARENT,
  REVIEW_REASONS,
} from "../../constants";
import type { DuplicateAnalysisParameters } from "../../types";

const REVIEW_REASON_SQL_LIST = REVIEW_REASONS.map((reason) => `'${reason}'`).join(", ");

/**
 * Port of CGEO-2192 `prod/v3/find_removal_candidates.sql`, the validated engine of this module.
 *
 * Differences from v3, and only these: every tunable is a bound parameter, the decision carries a
 * `decision_reason`, the `$7` toggle can remove a lone ANTEL/TLK beside a protected row, and `$8`
 * can widen the output to every duplicate group. The match key is written once, in `keyed`.
 * Literals interpolated below are module constants, never request data.
 *
 * $1 text[]  detection fuentes           $5 int      geo decimals with padron
 * $2 int     province id                 $6 int      geo decimals without padron
 * $3 text[]  removable fuentes           $7 boolean  protectedSiblingRemovesLone
 * $4 text[]  protected fuentes           $8 text     output scope
 */
export const DUPLICATE_ANALYSIS_SQL = `
WITH src AS (
  SELECT b.name_font AS fuente,
         b.urn,
         b.name_province AS province,
         b.code_province AS province_code,
         b.rs_censal_locality_code AS locality_code,
         b.rs_censal_locality_name AS locality,
         b.rs_name AS street_name,
         b.number AS street_number,
         b.letter,
         b.square,
         b.sandlot,
         b.km,
         b.type_padron,
         b.padron_number AS padron,
         b.pad_cadastral_locality_name AS padron_locality,
         b.postal_code,
         b.block,
         b.tower,
         b.floor,
         b.unit,
         b.code_country,
         b.name_country,
         b.id_province,
         b.rs_censal_locality_name AS raw_rs_censal_locality_name,
         b.rs_censal_locality_code AS raw_rs_censal_locality_code,
         b.rs_cadastral_locality_name,
         b.rs_idcalle,
         b.rs_name AS raw_rs_name,
         b.rs_reftramo,
         b.rs_short_name,
         b.number AS raw_number,
         b.side,
         b.padron_number AS raw_padron_number,
         b.latitud AS lat,
         b.longitud AS lng,
         b.document_type
  FROM carto.v_address_build b
  WHERE b.name_font = ANY($1::text[])  -- protected sources are detected too, so duplicates against them are seen
    AND b.id_province = $2::int
    AND b.document_type = '${DOCUMENT_TYPE_PARENT}'
),
keyed AS (
  SELECT *,
         CASE
           -- rows with no padron AND no street name have nothing to anchor a
           -- duplicate match on; give them a key unique to their own urn so
           -- they can never falsely group with another such row, instead of
           -- dropping them from the pipeline entirely (which would also skip
           -- their infra-match check -- a real bug caught by comparing this
           -- CTE's row count against src's).
           WHEN coalesce(btrim(padron), '') = '' AND coalesce(btrim(street_name), '') = ''
             THEN 'NOKEY:' || urn
           ELSE
             upper(trim(province)) || '|' ||
               upper(trim(coalesce(province_code, ''))) || '|' ||
               upper(trim(coalesce(locality_code, ''))) || '|' ||
               upper(trim(coalesce(locality, ''))) || '|' ||
               upper(trim(coalesce(postal_code, ''))) || '|' ||
               upper(trim(padron_locality_or_geo)) || '|' ||
               CASE WHEN street_name IS NULL OR btrim(street_name) = '' THEN 'NONE' ELSE upper(trim(street_name)) END || '|' ||
               CASE WHEN street_number IS NULL OR upper(trim(street_number)) IN ('S/N', 'SN', '0', '', 'N/A') THEN 'NONE' ELSE upper(trim(street_number)) END || '|' ||
               CASE WHEN letter IS NULL OR upper(trim(letter)) IN ('S/N', 'SN', '0', '', 'N/A') THEN 'NONE' ELSE upper(trim(letter)) END || '|' ||
               CASE WHEN square IS NULL OR upper(trim(square)) IN ('S/N', 'SN', '0', '', 'N/A') THEN 'NONE' ELSE upper(trim(square)) END || '|' ||
               CASE WHEN sandlot IS NULL OR upper(trim(sandlot)) IN ('S/N', 'SN', '0', '', 'N/A') THEN 'NONE' ELSE upper(trim(sandlot)) END || '|' ||
               CASE WHEN km IS NULL THEN 'NONE' ELSE km::text END || '|' ||
               CASE WHEN padron IS NULL OR btrim(padron) = '' THEN 'NONE' ELSE upper(trim(padron)) END || '|' ||
               CASE WHEN type_padron IS NULL OR btrim(type_padron) = '' THEN 'NONE' ELSE upper(trim(type_padron)) END || '|' ||
               CASE WHEN rs_reftramo IS NULL OR btrim(rs_reftramo::text) = '' THEN 'NONE' ELSE upper(trim(rs_reftramo::text)) END
         END AS match_key,
         substring(urn FROM 'id:(\\d+)$')::bigint AS urn_num
  FROM src
  CROSS JOIN LATERAL (
    SELECT coalesce(padron_locality,
             CASE WHEN padron IS NOT NULL AND btrim(padron) <> ''
                  THEN 'GEO:' || round(lat::numeric, $5::int) || ',' || round(lng::numeric, $5::int)   -- has padron, just missing padron_locality: ~1km bucket, already validated (v1 correction #5)
                  ELSE 'GEO:' || round(lat::numeric, $6::int) || ',' || round(lng::numeric, $6::int)    -- no padron at all: weaker anchor overall, so tighter ~100m bucket
             END) AS padron_locality_or_geo
  ) AS segment
),
dup_counts AS (
  SELECT match_key,
         count(*) AS dup_group_size
  FROM keyed
  GROUP BY match_key
),
pool_rank AS (
  -- rank among removal-eligible members only (removable fuentes, never a
  -- protected one) within the group -- used only as the fallback tiebreak
  -- when nothing in the group has a match. Protected members are not ranked,
  -- so the lowest-urn removable member is KEEP even if the group holds a
  -- protected row (that case is reported as KEPT_ALONGSIDE_PROTECTED).
  SELECT urn, match_key,
         row_number() OVER (PARTITION BY match_key ORDER BY urn_num NULLS LAST) AS pool_rank_in_group
  FROM keyed
  WHERE fuente = ANY($3::text[])
),
stc_urns AS (
  SELECT DISTINCT urn FROM match_tlk.direcciones_tlk_serv_cto_cgeo
),
npd_urns AS (
  SELECT DISTINCT urn_site_location AS urn FROM integrador.nap_physical_device
),
internal_unit_urns AS (
  SELECT DISTINCT am.urn
  FROM carto.addresses_master am
  JOIN carto.address a ON a.id_address_master = am.addresses_master_id
  JOIN carto.internal_address_access_point iaap ON iaap.id_access_point = a.id
),
pool AS (
  -- every source here, not just removable ones -- protected rows are kept in
  -- the output for context (a duplicate group's protected sibling explains
  -- why a removable row was judged redundant), even though they are never
  -- themselves removal-eligible (enforced in the decision CASE below, not by
  -- filtering rows out here).
  SELECT k.*, dc.dup_group_size, pr.pool_rank_in_group,
         (stc.urn IS NOT NULL) AS matched_serv_cto_tlk,
         (npd.urn IS NOT NULL) AS matched_nap_physical_device,
         (iu.urn IS NOT NULL) AS has_internal_units
  FROM keyed k
  JOIN dup_counts dc USING (match_key)
  LEFT JOIN pool_rank pr ON pr.urn = k.urn
  LEFT JOIN stc_urns stc ON stc.urn = k.urn
  LEFT JOIN npd_urns npd ON npd.urn = k.urn
  LEFT JOIN internal_unit_urns iu ON iu.urn = k.urn
),
pool_calc AS (
  SELECT *,
         (matched_serv_cto_tlk OR matched_nap_physical_device) AS matched,
         -- how many removable members of this group have a match -- 0 means
         -- the group-wide "nothing matched, lowest urn wins" branch applies
         count(*) FILTER (WHERE fuente = ANY($3::text[]) AND (matched_serv_cto_tlk OR matched_nap_physical_device))
           OVER (PARTITION BY match_key) AS n_matched_in_group,
         bool_or(fuente = ANY($4::text[])) OVER (PARTITION BY match_key) AS has_protected_in_group
  FROM pool
),
reasoned_raw AS (
  SELECT *,
         CASE
           WHEN fuente = ANY($4::text[]) THEN '${DecisionReason.PROTECTED_SOURCE}'  -- the only sources excluded from removal entirely
           WHEN matched THEN '${DecisionReason.INFRA_MATCHED}'
           WHEN dup_group_size = 1 THEN '${DecisionReason.NO_DUPLICATE}'
           WHEN $7::boolean AND fuente = ANY($3::text[]) AND has_protected_in_group
             THEN '${DecisionReason.REDUNDANT_WITH_PROTECTED}'
           WHEN fuente = ANY($3::text[]) AND n_matched_in_group = 0 AND pool_rank_in_group = 1
             THEN CASE WHEN has_protected_in_group
                       THEN '${DecisionReason.KEPT_ALONGSIDE_PROTECTED}'
                       ELSE '${DecisionReason.LOWEST_URN_KEPT}'
                  END
           WHEN n_matched_in_group > 0 THEN '${DecisionReason.REDUNDANT_WITH_MATCHED}'
           ELSE '${DecisionReason.REDUNDANT_NOT_LOWEST_URN}'
         END AS base_reason
  FROM pool_calc
),
reasoned AS (
  -- a row about to be removed that still has internal/apartment units attached is kept for review:
  -- deleting the door would orphan them (mirrors carto.baja_direccion's refusal to cascade)
  SELECT *,
         CASE
           WHEN fuente = ANY($3::text[]) AND has_internal_units AND base_reason IN (
                  '${DecisionReason.REDUNDANT_WITH_MATCHED}',
                  '${DecisionReason.REDUNDANT_NOT_LOWEST_URN}',
                  '${DecisionReason.REDUNDANT_WITH_PROTECTED}')
             THEN '${DecisionReason.HAS_INTERNAL_UNITS}'
           ELSE base_reason
         END AS decision_reason
  FROM reasoned_raw
),
decided AS (
  SELECT *,
         CASE WHEN decision_reason IN (
                '${DecisionReason.REDUNDANT_WITH_MATCHED}',
                '${DecisionReason.REDUNDANT_NOT_LOWEST_URN}',
                '${DecisionReason.REDUNDANT_WITH_PROTECTED}')
              THEN '${Decision.REMOVE}'
              ELSE '${Decision.KEEP}'
         END AS decision
  FROM reasoned
),
output_groups AS (
  SELECT DISTINCT match_key
  FROM decided
  WHERE decision = '${Decision.REMOVE}'
     OR decision_reason = ANY(ARRAY[${REVIEW_REASON_SQL_LIST}])
     OR ($8::text = '${DedupScope.ALL_DUPLICATE_GROUPS}' AND dup_group_size > 1)
)
SELECT dense_rank() OVER (ORDER BY d.match_key) AS group_id,
       d.fuente, d.urn, d.province, d.locality, d.street_name, d.street_number, d.letter,
       d.square, d.sandlot, d.km, d.padron, d.type_padron, d.postal_code, d.lat, d.lng, d.document_type,
       d.matched_serv_cto_tlk, d.matched_nap_physical_device, d.has_internal_units,
       d.dup_group_size, d.n_matched_in_group, d.pool_rank_in_group, d.decision, d.decision_reason,
       d.block, d.tower, d.floor, d.unit, d.code_country, d.name_country, d.id_province,
       d.raw_rs_censal_locality_name, d.raw_rs_censal_locality_code, d.rs_cadastral_locality_name,
       d.rs_idcalle, d.raw_rs_name, d.rs_reftramo, d.rs_short_name, d.raw_number, d.side, d.raw_padron_number,
       d.province_code, d.padron_locality, d.padron_locality_or_geo, d.match_key
FROM decided d
JOIN output_groups g USING (match_key)
ORDER BY group_id, (d.decision = '${Decision.REMOVE}'), d.fuente, d.urn;
`;

/** Values in `$1`..`$8` order. The only place that order is defined. */
export function toQueryValues(parameters: DuplicateAnalysisParameters): unknown[] {
  return [
    [...parameters.detectionFuentes],
    parameters.provinceId,
    [...parameters.removableFuentes],
    [...parameters.protectedFuentes],
    parameters.geoDecimalsWithPadron,
    parameters.geoDecimalsWithoutPadron,
    parameters.protectedSiblingRemovesLone,
    parameters.scope,
  ];
}
