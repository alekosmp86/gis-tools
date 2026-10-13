import { formatNumber } from "@/core/common/ValueFormatter";
import type { ShpPlan } from "../types";

const MS_PER_MINUTE = 60_000;

export const CheckLevel = {
  OK: "OK",
  WARNING: "WARNING",
  ERROR: "ERROR",
} as const;

export type CheckLevel = (typeof CheckLevel)[keyof typeof CheckLevel];

export interface PlanCheck {
  readonly key: string;
  readonly level: CheckLevel;
  readonly label: string;
  readonly detail: string;
}

const NO_BLOCKERS: PlanCheck = {
  key: "blockers-ok",
  level: CheckLevel.OK,
  label: "Tabla, bloqueos y PostGIS",
  detail: "La tabla existe, nadie la está cargando y PostGIS está disponible.",
};

const PRIVILEGES_OK: PlanCheck = {
  key: "privileges-ok",
  level: CheckLevel.OK,
  label: "Privilegios",
  detail: "El usuario tiene los privilegios necesarios.",
};

function blockerChecks(plan: ShpPlan): PlanCheck[] {
  if (plan.blockers.length === 0) return [NO_BLOCKERS];
  return plan.blockers.map((message) => ({ key: `blocker-${message}`, level: CheckLevel.ERROR, label: "Bloqueo", detail: message }));
}

function privilegeChecks(plan: ShpPlan): PlanCheck[] {
  if (plan.privilegeShortfalls.length === 0) return [PRIVILEGES_OK];
  return plan.privilegeShortfalls.map((message) => ({
    key: `privilege-${message}`,
    level: CheckLevel.ERROR,
    label: "Privilegios",
    detail: message,
  }));
}

function leftoverChecks(plan: ShpPlan): PlanCheck[] {
  if (plan.leftovers.length === 0) return [];
  const detail = `Ya existen tablas de trabajo de una carga anterior: ${plan.leftovers.join(", ")}.`;
  return [{ key: "leftovers", level: CheckLevel.WARNING, label: "Tablas de trabajo previas", detail }];
}

function infoChecks(plan: ShpPlan): PlanCheck[] {
  const rows = plan.currentRows === null ? "no disponible" : formatNumber(plan.currentRows);
  return [
    { key: "rows", level: CheckLevel.OK, label: "Filas actuales", detail: `public.${plan.target.table} tiene ${rows} filas.` },
    {
      key: "duration",
      level: CheckLevel.OK,
      label: "Duración estimada",
      detail: `Alrededor de ${Math.max(1, Math.round(plan.expectedMs / MS_PER_MINUTE))} min.`,
    },
  ];
}

/** The plan as a flat checklist for the screen: what blocks, what only warns, and what is fine. */
export function buildPlanChecks(plan: ShpPlan): PlanCheck[] {
  return [...blockerChecks(plan), ...privilegeChecks(plan), ...leftoverChecks(plan), ...infoChecks(plan)];
}
