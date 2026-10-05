import type { ModuleEndpointHandler } from "@/core/modules/contracts";
import { RemovalRefusedError } from "../domain/removal";
import {
  FINGERPRINT_PATTERN,
  MOTIVO_MAX_LENGTH,
  OPERATION_ID_PATTERN,
  RESPONSABLE_MAX_LENGTH,
} from "../removalConstants";
import type {
  RemovalExecutionRequest,
  RemovalPlan,
  RemovalSimulationPayload,
  RemovalSimulationRequest,
} from "../removalTypes";
import type { DedupOrchestrator } from "../services/DedupOrchestrator";
import { failure, HTTP_STATUS, jsonResponse, toErrorResponse } from "./httpResponses";
import {
  readConnection,
  readJsonBody,
  readProvinceId,
  readText,
  readToggle,
  type ParsedBody,
  type ValidationResult,
} from "./requestReaders";

/**
 * Handlers of the removal path. Neither endpoint reads an address list from the request: the
 * targets are always derived server-side from a fresh analysis, so the body can only name the
 * connection, the province, the confirmation and the fingerprint being confirmed.
 */

const REMOVAL_FAILURE_MESSAGE = "No se pudo completar la baja.";

export interface RemovalHandlers {
  readonly simulateRemoval: ModuleEndpointHandler;
  readonly executeRemoval: ModuleEndpointHandler;
}

type RemovalConfirmationFields = Pick<
  RemovalExecutionRequest,
  "operationId" | "responsable" | "motivo" | "expectedFingerprint"
>;

function readSimulationRequest(body: ParsedBody): ValidationResult<RemovalSimulationRequest> {
  const connection = readConnection(body);
  if (!connection.ok) return connection;
  const provinceId = readProvinceId(body);
  if (!provinceId.ok) return provinceId;
  const toggle = readToggle(body);
  if (!toggle.ok) return toggle;

  return {
    ok: true,
    value: {
      connection: connection.value,
      provinceId: provinceId.value,
      protectedSiblingRemovesLone: toggle.value,
    },
  };
}

function readOperationId(body: ParsedBody): ValidationResult<string> {
  if (body.operationId === undefined) return { ok: true, value: crypto.randomUUID() };
  const operationId = readText(body.operationId);
  if (!OPERATION_ID_PATTERN.test(operationId)) {
    return { ok: false, error: "El identificador de la operación no es un UUID válido." };
  }
  return { ok: true, value: operationId.toLowerCase() };
}

function readConfirmation(body: ParsedBody): ValidationResult<RemovalConfirmationFields> {
  const operationId = readOperationId(body);
  if (!operationId.ok) return operationId;
  const responsable = readText(body.responsable);
  const motivo = readText(body.motivo);
  if (!responsable || !motivo) {
    return { ok: false, error: "El responsable y el motivo son obligatorios." };
  }
  if (responsable.length > RESPONSABLE_MAX_LENGTH) {
    return { ok: false, error: `El responsable no puede superar los ${RESPONSABLE_MAX_LENGTH} caracteres.` };
  }
  if (motivo.length > MOTIVO_MAX_LENGTH) {
    return { ok: false, error: `El motivo no puede superar los ${MOTIVO_MAX_LENGTH} caracteres.` };
  }
  const expectedFingerprint = readText(body.expectedFingerprint);
  if (!FINGERPRINT_PATTERN.test(expectedFingerprint)) {
    return { ok: false, error: "Falta la huella de la simulación que se confirma." };
  }

  return {
    ok: true,
    value: { operationId: operationId.value, responsable, motivo, expectedFingerprint },
  };
}

function readExecutionRequest(body: ParsedBody): ValidationResult<RemovalExecutionRequest> {
  const simulation = readSimulationRequest(body);
  if (!simulation.ok) return simulation;
  const confirmation = readConfirmation(body);
  if (!confirmation.ok) return confirmation;

  return { ok: true, value: { ...simulation.value, ...confirmation.value } };
}

/** The snapshot stays server-side (it is stored in the audit row); the browser gets the counts and the urn list to review. */
function toSimulationPayload(plan: RemovalPlan): RemovalSimulationPayload {
  return { fingerprint: plan.fingerprint, counts: plan.counts, blockers: plan.blockers, targets: plan.targets };
}

function toRemovalErrorResponse(error: unknown, secret: string): Response {
  const status = error instanceof RemovalRefusedError ? HTTP_STATUS.CONFLICT : HTTP_STATUS.SERVER_ERROR;
  return toErrorResponse(error, secret, REMOVAL_FAILURE_MESSAGE, status);
}

export function createRemovalHandlers(orchestrator: DedupOrchestrator): RemovalHandlers {
  return {
    simulateRemoval: async (request) => {
      const body = await readJsonBody(request);
      if (!body) return failure("El cuerpo de la solicitud debe ser un JSON válido.", HTTP_STATUS.BAD_REQUEST);

      const simulation = readSimulationRequest(body);
      if (!simulation.ok) return failure(simulation.error, HTTP_STATUS.BAD_REQUEST);

      try {
        const plan = await orchestrator.simulateRemoval(simulation.value);
        return jsonResponse({ success: true, ...toSimulationPayload(plan) });
      } catch (error: unknown) {
        return toRemovalErrorResponse(error, simulation.value.connection.password);
      }
    },

    executeRemoval: async (request) => {
      const body = await readJsonBody(request);
      if (!body) return failure("El cuerpo de la solicitud debe ser un JSON válido.", HTTP_STATUS.BAD_REQUEST);

      const execution = readExecutionRequest(body);
      if (!execution.ok) return failure(execution.error, HTTP_STATUS.BAD_REQUEST);

      try {
        const result = await orchestrator.executeRemoval(execution.value);
        return jsonResponse({ success: true, ...result });
      } catch (error: unknown) {
        return toRemovalErrorResponse(error, execution.value.connection.password);
      }
    },
  };
}
