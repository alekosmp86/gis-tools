import { Decision, DecisionReason, Fuente } from "../../../src/modules/address-dedup/constants";
import { groupRows } from "../../../src/modules/address-dedup/domain/groups";
import { summarizeRows } from "../../../src/modules/address-dedup/domain/summary";
import type { AnalysisRow } from "../../../src/modules/address-dedup/types";

/** Only the fields the UI and the summary read; the rest of the row is irrelevant to these flows. */
interface RowSeed {
  readonly group: number;
  readonly fuente: string;
  readonly idNumber: number;
  readonly decision: Decision;
  readonly reason: DecisionReason;
  readonly street?: string;
  readonly number?: string;
  readonly padron?: string;
  readonly locality?: string;
  readonly hasCoordinates?: boolean;
}

const URN_PREFIX: Readonly<Record<string, string>> = {
  [Fuente.ANTEL]: "cgeo:Antel:address:id:",
  [Fuente.IDE]: "cgeo:ideuy:address:id:",
  [Fuente.TLK]: "cgeo:TLK:wstlk:id:",
  "": "cgeo:unknown:address:id:",
};

function toRow(seed: RowSeed): AnalysisRow {
  const hasCoordinates = seed.hasCoordinates ?? true;
  return {
    group_id: seed.group,
    fuente: seed.fuente,
    urn: `${URN_PREFIX[seed.fuente]}${seed.idNumber}`,
    province: "SAN JOSE",
    province_code: "UY-SJ",
    raw_rs_censal_locality_code: "7001",
    postal_code: "80000",
    padron_locality_or_geo: seed.locality ?? "GEO:-33.46,-56.73",
    letter: null,
    square: null,
    sandlot: null,
    km: null,
    rs_reftramo: null,
    match_key: `SAN JOSE|UY-SJ|7001|${seed.locality ?? ""}|80000|${seed.group}`,
    street_name: seed.street ?? null,
    street_number: seed.number ?? null,
    padron: seed.padron ?? null,
    type_padron: seed.padron ? "URBANO" : null,
    locality: seed.locality ?? null,
    lat: hasCoordinates ? -33.46 : null,
    lng: hasCoordinates ? -56.73 : null,
    decision: seed.decision,
    decision_reason: seed.reason,
  } as AnalysisRow;
}

const SEEDS: ReadonlyArray<RowSeed> = [
  { group: 1, fuente: Fuente.ANTEL, idNumber: 101, decision: Decision.KEEP, reason: DecisionReason.LOWEST_URN_KEPT, street: "ARTIGAS", number: "5", padron: "100", locality: "TRINIDAD" },
  { group: 1, fuente: Fuente.ANTEL, idNumber: 102, decision: Decision.REMOVE, reason: DecisionReason.REDUNDANT_NOT_LOWEST_URN, street: "ARTIGAS", number: "5", padron: "100", locality: "TRINIDAD" },
  { group: 2, fuente: Fuente.IDE, idNumber: 201, decision: Decision.KEEP, reason: DecisionReason.PROTECTED_SOURCE, street: "RIVERA", number: "12", padron: "200", locality: "TRINIDAD" },
  { group: 2, fuente: Fuente.ANTEL, idNumber: 202, decision: Decision.KEEP, reason: DecisionReason.KEPT_ALONGSIDE_PROTECTED, street: "RIVERA", number: "12", padron: "200", locality: "TRINIDAD" },
  { group: 3, fuente: Fuente.TLK, idNumber: 301, decision: Decision.KEEP, reason: DecisionReason.INFRA_MATCHED, street: "ZORRILLA", number: "7", padron: "300", locality: "ISMAEL CORTINAS" },
  { group: 3, fuente: Fuente.ANTEL, idNumber: 302, decision: Decision.REMOVE, reason: DecisionReason.REDUNDANT_WITH_MATCHED, street: "ZORRILLA", number: "7", padron: "300", locality: "ISMAEL CORTINAS" },
  { group: 4, fuente: Fuente.ANTEL, idNumber: 401, decision: Decision.KEEP, reason: DecisionReason.LOWEST_URN_KEPT, padron: "400", hasCoordinates: false },
  { group: 4, fuente: "", idNumber: 402, decision: Decision.REMOVE, reason: DecisionReason.REDUNDANT_NOT_LOWEST_URN, padron: "400" },
  { group: 5, fuente: Fuente.ANTEL, idNumber: 501, decision: Decision.KEEP, reason: DecisionReason.INFRA_MATCHED, street: "ROSARIO", number: "3", padron: "500", locality: "TRINIDAD" },
  { group: 5, fuente: Fuente.TLK, idNumber: 502, decision: Decision.KEEP, reason: DecisionReason.INFRA_MATCHED, street: "ROSARIO", number: "3", padron: "500", locality: "TRINIDAD" },
  { group: 6, fuente: Fuente.TLK, idNumber: 601, decision: Decision.KEEP, reason: DecisionReason.LOWEST_URN_KEPT, street: "BRUM", number: "9", padron: "600", locality: "TRINIDAD" },
  { group: 6, fuente: Fuente.ANTEL, idNumber: 602, decision: Decision.REMOVE, reason: DecisionReason.REDUNDANT_NOT_LOWEST_URN, street: "BRUM", number: "9", padron: "600", locality: "TRINIDAD" },
];

export const DEDUP_ROWS: ReadonlyArray<AnalysisRow> = SEEDS.map(toRow);

export const DEDUP_GROUP_COUNT = 6;

export const DEDUP_ANALYZE_RESPONSE = {
  success: true,
  summary: summarizeRows(DEDUP_ROWS),
  groups: groupRows(DEDUP_ROWS),
  skippedWithoutCoordinates: 1,
};

export const DEDUP_CSV_BODY = "group_id,fuente,urn\r\n1,ANTEL,cgeo:Antel:address:id:101\r\n";
