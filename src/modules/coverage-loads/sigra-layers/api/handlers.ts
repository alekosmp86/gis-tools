import type { ModuleEndpointHandler } from "@/core/modules/contracts";
import { failure, HTTP_STATUS, jsonResponse, toErrorResponse } from "../../shared/httpResponses";
import { readConnection, readJsonBody } from "../../shared/requestReaders";
import { mapSequentially } from "../../shared/sequentially";
import type { DbConnection } from "../../types";
import type { SigraLayerId } from "../constants";
import { getSigraLayer } from "../domain/layerRegistry";
import { buildSigraPlan } from "../domain/plan";
import { PgSigraLayersRepository } from "../services/PgSigraLayersRepository";
import { probeLayers } from "../services/probeLayers";
import type { SigraLayersRepository } from "../services/SigraLayersRepository";
import { createWfsPageFetcher } from "../services/WfsClient";
import type { LayerLoadResult, SigraPlan, WfsPageFetcher } from "../types";
import { readLoadSelection, readPlanLayerIds } from "./requestReaders";

/**
 * HTTP surface of the Capas SIGRA part. Handlers stay thin: parse and validate, call the domain and
 * the repository, shape the response. The password is scrubbed from any error text before it leaves.
 */

const PLAN_FAILURE_MESSAGE = "No se pudo preparar el plan de carga de las capas SIGRA.";
const LOAD_FAILURE_MESSAGE = "No se pudo completar la carga de las capas SIGRA.";
const INVALID_JSON_MESSAGE = "El cuerpo de la solicitud debe ser un JSON válido.";
const BLOCKED_MESSAGE = "Hay capas con bloqueos: no se cargó ninguna.";

export interface SigraLayersHandlers {
  readonly plan: ModuleEndpointHandler;
  readonly load: ModuleEndpointHandler;
}

export interface SigraLayersHandlerDependencies {
  readonly repository?: SigraLayersRepository;
  readonly fetcher?: WfsPageFetcher;
}

async function loadSequentially(
  repository: SigraLayersRepository,
  connection: DbConnection,
  layerIds: ReadonlyArray<SigraLayerId>,
  dryRun: boolean,
): Promise<LayerLoadResult[]> {
  return mapSequentially(layerIds, (layerId) => repository.loadLayer(connection, layerId, { dryRun }));
}

/** Database state plus, when a fetcher is given, the WFS probes; the load path passes none. */
async function inspectPlan(
  repository: SigraLayersRepository,
  connection: DbConnection,
  layerIds: ReadonlyArray<SigraLayerId>,
  fetcher: WfsPageFetcher | null,
): Promise<SigraPlan> {
  const state = await repository.inspect(connection, layerIds);
  const probes = fetcher ? await probeLayers(layerIds.map(getSigraLayer), fetcher) : [];
  return buildSigraPlan({ layerIds, state, probes });
}

export function createSigraLayersHandlers(dependencies: SigraLayersHandlerDependencies = {}): SigraLayersHandlers {
  const repository = dependencies.repository ?? new PgSigraLayersRepository();
  const fetcher = dependencies.fetcher ?? createWfsPageFetcher();

  const plan: ModuleEndpointHandler = async (request) => {
    const body = await readJsonBody(request);
    if (!body) return failure(INVALID_JSON_MESSAGE, HTTP_STATUS.BAD_REQUEST);
    const connection = readConnection(body);
    if (!connection.ok) return failure(connection.error, HTTP_STATUS.BAD_REQUEST);
    const layerIds = readPlanLayerIds(body);
    if (!layerIds.ok) return failure(layerIds.error, HTTP_STATUS.BAD_REQUEST);

    try {
      const result = await inspectPlan(repository, connection.value, layerIds.value, fetcher);
      return jsonResponse({ success: true, plan: result });
    } catch (error: unknown) {
      return toErrorResponse(error, connection.value.password, PLAN_FAILURE_MESSAGE);
    }
  };

  const load: ModuleEndpointHandler = async (request) => {
    const body = await readJsonBody(request);
    if (!body) return failure(INVALID_JSON_MESSAGE, HTTP_STATUS.BAD_REQUEST);
    const connection = readConnection(body);
    if (!connection.ok) return failure(connection.error, HTTP_STATUS.BAD_REQUEST);
    const selection = readLoadSelection(body);
    if (!selection.ok) return failure(selection.error, HTTP_STATUS.BAD_REQUEST);
    const { layerIds, dryRun } = selection.value;

    try {
      const loadPlan = await inspectPlan(repository, connection.value, layerIds, null);
      if (loadPlan.layers.some((layer) => !layer.canLoad)) {
        return failure(BLOCKED_MESSAGE, HTTP_STATUS.CONFLICT, { plan: loadPlan });
      }
      const results = await loadSequentially(repository, connection.value, layerIds, dryRun);
      return jsonResponse({ success: true, dryRun, results });
    } catch (error: unknown) {
      return toErrorResponse(error, connection.value.password, LOAD_FAILURE_MESSAGE);
    }
  };

  return { plan, load };
}
