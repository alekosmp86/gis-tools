import { buildQualifiedTableLabel } from "@/core/services/sqlStatements";
import type { TableLayout } from "../actualizar-padron/domain/layouts";
import type { AddressMasterAmbiguous, AddressMasterCounts, AddressMasterLinked, AddressMasterPassBody } from "./addressMasterLinkPass";

type AddressMasterReportCounts = AddressMasterCounts & { toCreate: number; remaining: number };

export interface AddressMasterReport {
  table: string;
  counts: AddressMasterReportCounts;
  linkedList: AddressMasterLinked[];
  ambiguousSamples: AddressMasterAmbiguous[];
}

export function buildAddressMasterReport(addressMaster: TableLayout, pass: AddressMasterPassBody): AddressMasterReport {
  return {
    table: buildQualifiedTableLabel(addressMaster.schema, addressMaster.table),
    counts: { ...pass.counts, toCreate: pass.toCreate, remaining: pass.remaining },
    linkedList: pass.linkedList,
    ambiguousSamples: pass.ambiguousSamples,
  };
}
