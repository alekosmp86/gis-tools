import { DedupRules } from "../constants";
import { summarizeRows } from "../domain/summary";
import type {
  RemovalExecutionRequest,
  RemovalPlan,
  RemovalResult,
  RemovalSimulationRequest,
} from "../removalTypes";
import type {
  DbConnection,
  DedupRequest,
  DedupResult,
  DuplicateAnalysisParameters,
  ProvinceOption,
} from "../types";
import type { AddressRepository } from "./AddressRepository";
import type { RemovalRepository } from "./RemovalRepository";

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

/**
 * Maps a request to the query parameters, runs it through the repository and summarises the rows.
 * Removal requests map to the same parameters, so the removal plan is the analysis the user saw.
 */
export class DedupOrchestrator {
  constructor(
    private readonly repository: AddressRepository,
    private readonly removalRepository: RemovalRepository
  ) {}

  async analyze(request: DedupRequest): Promise<DedupResult> {
    const rows = await this.repository.runDuplicateAnalysis({
      connection: request.connection,
      parameters: toParameters(request),
    });

    return { rows, summary: summarizeRows(rows) };
  }

  listProvinces(connection: DbConnection): Promise<ProvinceOption[]> {
    return this.repository.listProvinces(connection);
  }

  simulateRemoval(request: RemovalSimulationRequest): Promise<RemovalPlan> {
    return this.removalRepository.simulateRemoval({
      connection: request.connection,
      parameters: toParameters(request),
    });
  }

  executeRemoval(request: RemovalExecutionRequest): Promise<RemovalResult> {
    return this.removalRepository.executeRemoval(
      { connection: request.connection, parameters: toParameters(request) },
      {
        operationId: request.operationId,
        responsable: request.responsable,
        motivo: request.motivo,
        expectedFingerprint: request.expectedFingerprint,
      }
    );
  }
}
