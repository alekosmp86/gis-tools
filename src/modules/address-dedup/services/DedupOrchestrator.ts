import { DedupRules } from "../constants";
import { summarizeRows } from "../domain/summary";
import type { DedupRequest, DedupResult, DuplicateAnalysisParameters } from "../types";
import type { AddressRepository } from "./AddressRepository";

function listDetectionFuentes(): string[] {
  return [...new Set<string>([...DedupRules.REMOVABLE_FUENTES, ...DedupRules.PROTECTED_FUENTES])];
}

function toParameters(request: DedupRequest): DuplicateAnalysisParameters {
  return {
    detectionFuentes: listDetectionFuentes(),
    provinceId: request.provinceId,
    removableFuentes: DedupRules.REMOVABLE_FUENTES,
    protectedFuentes: DedupRules.PROTECTED_FUENTES,
    geoDecimalsWithPadron: DedupRules.GEO_DECIMALS_WITH_PADRON,
    geoDecimalsWithoutPadron: DedupRules.GEO_DECIMALS_WITHOUT_PADRON,
    protectedSiblingRemovesLone:
      request.protectedSiblingRemovesLone ?? DedupRules.PROTECTED_SIBLING_REMOVES_LONE,
    scope: request.scope ?? DedupRules.SCOPE,
  };
}

/** Maps a request to the query parameters, runs it through the repository and summarises the rows. */
export class DedupOrchestrator {
  constructor(private readonly repository: AddressRepository) {}

  async analyze(request: DedupRequest): Promise<DedupResult> {
    const rows = await this.repository.runDuplicateAnalysis({
      connection: request.connection,
      parameters: toParameters(request),
    });

    return { rows, summary: summarizeRows(rows) };
  }
}
