import { Decision } from "../../../src/modules/address-dedup/constants";
import { groupRows } from "../../../src/modules/address-dedup/domain/groups";
import { summarizeRows } from "../../../src/modules/address-dedup/domain/summary";
import {
  RemovalBlockReason,
  RemovalState,
  REMOVAL_PENDING_MESSAGE,
} from "../../../src/modules/address-dedup/removalConstants";
import { DEDUP_ROWS } from "./dedupFixtures";

export const REMOVAL_FINGERPRINT = "0123456789abcdef0123456789abcdef";

const ROWS_BY_TABLE = {
  internal_address_access_point: 0,
  territorial_unit_access_point: 4,
  compact_address: 4,
  internal_address: 0,
  access_point: 4,
  address: 4,
  addresses_master: 4,
};

const COUNTS = { total: 4, byFuente: { ANTEL: 3, TLK: 1 }, rowsByTable: ROWS_BY_TABLE };

export const REMOVAL_TARGETS = [
  { urn: "cgeo:Antel:address:id:101", fuente: "ANTEL" },
  { urn: "cgeo:Antel:address:id:102", fuente: "ANTEL" },
  { urn: "cgeo:Antel:address:id:103", fuente: "ANTEL" },
  { urn: "cgeo:TLK:wstlk:id:201", fuente: "TLK" },
];

export const REMOVAL_SIMULATION = {
  success: true,
  fingerprint: REMOVAL_FINGERPRINT,
  counts: COUNTS,
  blockers: [],
  targets: REMOVAL_TARGETS,
};

export const REMOVAL_BLOCKED_SIMULATION = {
  ...REMOVAL_SIMULATION,
  blockers: [
    {
      urn: "cgeo:Antel:address:id:102",
      reasons: [{ code: RemovalBlockReason.MASTER_SHARED, detail: null }],
    },
  ],
};

export function removalExecution(operationId: string) {
  return {
    success: true,
    operationId,
    fingerprint: REMOVAL_FINGERPRINT,
    state: RemovalState.DELETED_PENDING_INDEXES,
    counts: COUNTS,
    deletedByTable: ROWS_BY_TABLE,
    pending: REMOVAL_PENDING_MESSAGE,
    recovered: false,
  };
}

const KEEP_ONLY_ROWS = DEDUP_ROWS.filter((row) => row.decision === Decision.KEEP);

export const DEDUP_NO_REMOVALS_RESPONSE = {
  success: true,
  summary: summarizeRows(KEEP_ONLY_ROWS),
  groups: groupRows(KEEP_ONLY_ROWS),
  skippedWithoutCoordinates: 0,
};
