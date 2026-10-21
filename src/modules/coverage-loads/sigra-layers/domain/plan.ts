import { VALIDATION_MIN_RATIO, type SigraLayerId } from "../constants";
import type { LayerDbState, LayerProbe, PlanLayer, SigraDbState, SigraPlan, SigraPlanInput } from "../types";
import { getSigraLayer } from "./layerRegistry";

const TEMP_BLOCKER = "La base de datos no permite crear tablas temporales (falta el privilegio TEMP).";
const AUDIT_WARNING = "La tabla de auditoría no está disponible: la carga se ejecutará sin registro de auditoría.";

const missingTableBlocker = (table: string) => `La tabla ${table} no existe.`;
const privilegesBlocker = (table: string, privileges: ReadonlyArray<string>) =>
  `Faltan privilegios sobre ${table}: ${privileges.join(", ")}.`;
const ratioWarning = (label: string, wfsCount: number, rowCount: number) =>
  `${label}: el WFS devuelve ${wfsCount} registros y la tabla tiene ${rowCount}; la carga podría ser rechazada por la validación.`;

function layerBlockers(
  layerId: SigraLayerId,
  dbLayer: LayerDbState | undefined,
  probe: LayerProbe | undefined,
  canCreateTemp: boolean,
): string[] {
  const table = getSigraLayer(layerId).finalTable;
  const blockers: string[] = [];
  if (!canCreateTemp) blockers.push(TEMP_BLOCKER);
  if (!dbLayer?.tableExists) blockers.push(missingTableBlocker(table));
  if (dbLayer && dbLayer.missingPrivileges.length > 0) blockers.push(privilegesBlocker(table, dbLayer.missingPrivileges));
  if (probe?.error) blockers.push(probe.error);
  return blockers;
}

function buildPlanLayer(layerId: SigraLayerId, state: SigraDbState, probes: ReadonlyArray<LayerProbe>): PlanLayer {
  const definition = getSigraLayer(layerId);
  const dbLayer = state.layers.find((layer) => layer.layerId === layerId);
  const probe = probes.find((candidate) => candidate.layerId === layerId);
  const blockers = layerBlockers(layerId, dbLayer, probe, state.canCreateTemp);
  return {
    layerId,
    label: definition.label,
    required: definition.required,
    tableExists: dbLayer?.tableExists ?? false,
    rowCount: dbLayer?.rowCount ?? null,
    lastUpdated: dbLayer?.lastUpdated ?? null,
    missingPrivileges: dbLayer?.missingPrivileges ?? [],
    wfsCount: probe?.numberMatched ?? null,
    wfsError: probe?.error ?? null,
    blockers,
    canLoad: blockers.length === 0,
  };
}

function planBlockers(layers: ReadonlyArray<PlanLayer>, state: SigraDbState): string[] {
  const blockers = state.canCreateTemp ? [] : [TEMP_BLOCKER];
  for (const layer of layers) {
    for (const blocker of layer.blockers) blockers.push(`${layer.label}: ${blocker}`);
  }
  return [...new Set(blockers)];
}

function ratioWarnings(layers: ReadonlyArray<PlanLayer>): string[] {
  const warnings: string[] = [];
  for (const layer of layers) {
    const { wfsCount, rowCount } = layer;
    if (wfsCount === null || rowCount === null || rowCount <= 0) continue;
    if (wfsCount / rowCount < VALIDATION_MIN_RATIO) warnings.push(ratioWarning(layer.label, wfsCount, rowCount));
  }
  return warnings;
}

function planWarnings(layers: ReadonlyArray<PlanLayer>, state: SigraDbState): string[] {
  return [...(state.auditAvailable ? [] : [AUDIT_WARNING]), ...ratioWarnings(layers)];
}

export function buildSigraPlan({ layerIds, state, probes }: SigraPlanInput): SigraPlan {
  const layers = layerIds.map((layerId) => buildPlanLayer(layerId, state, probes));
  return {
    layers,
    blockers: planBlockers(layers, state),
    warnings: planWarnings(layers, state),
    canLoad: layers.length > 0 && layers.every((layer) => layer.canLoad),
  };
}
