import type { ParsedBody, ValidationResult } from "../../shared/requestReaders";
import type { SigraLayerId } from "../constants";
import { isSigraLayerId, SIGRA_LAYERS } from "../domain/layerRegistry";

const INVALID_LAYER_IDS_MESSAGE = "La lista de capas no es válida: debe tener al menos una capa conocida.";
const INVALID_FLAG_MESSAGE = "Los campos dryRun y confirm deben ser booleanos.";
const CONFIRMATION_REQUIRED_MESSAGE = "Hay que confirmar la carga para reemplazar las capas.";
const LAYER_IDS_REQUIRED_MESSAGE = "Hay que indicar las capas a cargar.";

export interface LoadSelection {
  readonly layerIds: SigraLayerId[];
  readonly dryRun: boolean;
}

function parseLayerIds(raw: unknown): ValidationResult<SigraLayerId[]> {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: INVALID_LAYER_IDS_MESSAGE };
  const ids = new Set<SigraLayerId>();
  for (const candidate of raw as unknown[]) {
    if (!isSigraLayerId(candidate)) return { ok: false, error: INVALID_LAYER_IDS_MESSAGE };
    ids.add(candidate);
  }
  return { ok: true, value: [...ids] };
}

/** An absent key means every registry layer; anything else present must be a valid, non-empty list. */
export function readPlanLayerIds(body: ParsedBody): ValidationResult<SigraLayerId[]> {
  if (body.layerIds === undefined) return { ok: true, value: SIGRA_LAYERS.map((layer) => layer.id) };
  return parseLayerIds(body.layerIds);
}

function readOptionalFlag(raw: unknown): ValidationResult<boolean> {
  if (raw === undefined) return { ok: true, value: false };
  return typeof raw === "boolean" ? { ok: true, value: raw } : { ok: false, error: INVALID_FLAG_MESSAGE };
}

/** `layerIds` is required; a real load (dryRun false) additionally needs `confirm === true`. */
export function readLoadSelection(body: ParsedBody): ValidationResult<LoadSelection> {
  if (body.layerIds === undefined) return { ok: false, error: LAYER_IDS_REQUIRED_MESSAGE };
  const layerIds = parseLayerIds(body.layerIds);
  if (!layerIds.ok) return layerIds;
  const dryRun = readOptionalFlag(body.dryRun);
  if (!dryRun.ok) return dryRun;
  const confirm = readOptionalFlag(body.confirm);
  if (!confirm.ok) return confirm;
  if (!dryRun.value && !confirm.value) return { ok: false, error: CONFIRMATION_REQUIRED_MESSAGE };
  return { ok: true, value: { layerIds: layerIds.value, dryRun: dryRun.value } };
}
