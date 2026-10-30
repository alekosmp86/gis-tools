import type { AddressMasterAmbiguous, AddressMasterLinked } from "../jobs/shared/addressMasterLinkPass";
import type { AddressMasterReport } from "../jobs/shared/addressMasterLinkReport";
import type { AddressMasterSubjectTexts } from "./addressMasterSubjectTexts";
import { reportRowToneOf, type ReportRowTone } from "./reportRowTone";
import { listSummaryOf } from "./reportViewParts";

export interface AddressMasterCountRow {
  label: string;
  value: number;
  tone: ReportRowTone;
}

export interface AddressMasterView {
  table: string;
  counts: AddressMasterCountRow[];
  linked: AddressMasterLinked[];
  linkedSummary: string;
  ambiguous: AddressMasterAmbiguous[];
  ambiguousSummary: string;
}

const countRowOf = (label: string, value: number, isNeutral = false): AddressMasterCountRow => ({
  label,
  value,
  tone: reportRowToneOf(value, isNeutral),
});

export function addressMasterViewOf(report: AddressMasterReport, texts: AddressMasterSubjectTexts): AddressMasterView {
  const { counts } = report;
  return {
    table: report.table,
    counts: [
      countRowOf(texts.withoutAddressMaster, counts.withoutAddressMaster, true),
      countRowOf("Registros por crear", counts.toCreate),
      countRowOf("Registros creados", counts.created),
      countRowOf(texts.linked, counts.linked),
      countRowOf("Ya tenían registro", counts.alreadyHadRecord, true),
      countRowOf(texts.ambiguous, counts.ambiguous),
      countRowOf("Sin dirección maestra después del enlace", counts.remaining),
    ],
    linked: report.linkedList,
    linkedSummary: listSummaryOf(texts.linked, report.linkedList.length, counts.linked),
    ambiguous: report.ambiguousSamples,
    ambiguousSummary: listSummaryOf(texts.ambiguous, report.ambiguousSamples.length, counts.ambiguous),
  };
}
