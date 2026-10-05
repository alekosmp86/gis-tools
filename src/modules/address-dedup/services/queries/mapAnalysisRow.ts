import type { Decision, DecisionReason } from "../../constants";
import type { AnalysisRow } from "../../types";

type RawRow = Record<string, unknown>;

function toNullableText(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function toText(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function toRequiredNumber(value: unknown): number {
  return toNullableNumber(value) ?? 0;
}

/**
 * Normalises a raw driver row. `pg` returns bigint aggregates (`dense_rank`, `count`) as strings
 * and may return numeric columns the same way, so every numeric field is coerced, not trusted.
 */
export function mapAnalysisRow(raw: RawRow): AnalysisRow {
  return {
    group_id: toRequiredNumber(raw.group_id),
    fuente: toText(raw.fuente),
    urn: toText(raw.urn),
    province: toNullableText(raw.province),
    locality: toNullableText(raw.locality),
    street_name: toNullableText(raw.street_name),
    street_number: toNullableText(raw.street_number),
    letter: toNullableText(raw.letter),
    square: toNullableText(raw.square),
    sandlot: toNullableText(raw.sandlot),
    km: toNullableText(raw.km),
    padron: toNullableText(raw.padron),
    type_padron: toNullableText(raw.type_padron),
    postal_code: toNullableText(raw.postal_code),
    lat: toNullableNumber(raw.lat),
    lng: toNullableNumber(raw.lng),
    document_type: toNullableText(raw.document_type),
    matched_serv_cto_tlk: Boolean(raw.matched_serv_cto_tlk),
    matched_nap_physical_device: Boolean(raw.matched_nap_physical_device),
    has_internal_units: Boolean(raw.has_internal_units),
    dup_group_size: toRequiredNumber(raw.dup_group_size),
    n_matched_in_group: toRequiredNumber(raw.n_matched_in_group),
    pool_rank_in_group: toNullableNumber(raw.pool_rank_in_group),
    decision: raw.decision as Decision,
    decision_reason: raw.decision_reason as DecisionReason,
    block: toNullableText(raw.block),
    tower: toNullableText(raw.tower),
    floor: toNullableText(raw.floor),
    unit: toNullableText(raw.unit),
    code_country: toNullableText(raw.code_country),
    name_country: toNullableText(raw.name_country),
    id_province: toNullableNumber(raw.id_province),
    raw_rs_censal_locality_name: toNullableText(raw.raw_rs_censal_locality_name),
    raw_rs_censal_locality_code: toNullableText(raw.raw_rs_censal_locality_code),
    rs_cadastral_locality_name: toNullableText(raw.rs_cadastral_locality_name),
    rs_idcalle: toNullableText(raw.rs_idcalle),
    raw_rs_name: toNullableText(raw.raw_rs_name),
    rs_reftramo: toNullableText(raw.rs_reftramo),
    rs_short_name: toNullableText(raw.rs_short_name),
    raw_number: toNullableText(raw.raw_number),
    side: toNullableText(raw.side),
    raw_padron_number: toNullableText(raw.raw_padron_number),
    province_code: toNullableText(raw.province_code),
    padron_locality: toNullableText(raw.padron_locality),
    padron_locality_or_geo: toNullableText(raw.padron_locality_or_geo),
    match_key: toText(raw.match_key),
  };
}
