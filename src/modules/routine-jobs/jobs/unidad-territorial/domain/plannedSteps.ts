import type { AddressMasterPassSteps } from "../../shared/addressMasterLinkPass";

export const UNIT_STEP = {
  VALIDATE: "Validar tablas, columnas y tipo de unidad",
  TARGET: "Validar tabla de destino",
  COUNT: "Contar filas de origen",
  RESOLVE: "Resolver localidades de origen",
  CLASSIFY: "Clasificar unidades territoriales",
  SEQUENCES: "Ajustar secuencias de destino",
  APPLY: "Aplicar cambios de unidades territoriales",
  ADDRESS_SEQUENCES: "Ajustar secuencia de direcciones maestras",
  ADDRESS_CLASSIFY: "Clasificar unidades sin dirección maestra",
  ADDRESS_APPLY: "Crear y enlazar direcciones maestras de unidades",
  ADDRESS_VERIFY: "Verificar unidades pendientes",
  ANALYZE: "Analizar tabla de destino",
  REPORT: "Generar informe",
  COMMIT: "Confirmar cambios",
  ROLLBACK: "Revertir cambios de la simulación",
} as const;

export const UNIT_ADDRESS_MASTER_PASS_STEPS: AddressMasterPassSteps = {
  classify: UNIT_STEP.ADDRESS_CLASSIFY,
  apply: UNIT_STEP.ADDRESS_APPLY,
  verify: UNIT_STEP.ADDRESS_VERIFY,
};

export interface UnitPlannedStepsInput {
  dryRun: boolean;
  linkAddressMaster?: boolean;
}

export function plannedUnitStepLabels({ dryRun, linkAddressMaster = false }: UnitPlannedStepsInput): string[] {
  return [
    UNIT_STEP.VALIDATE,
    UNIT_STEP.TARGET,
    UNIT_STEP.COUNT,
    UNIT_STEP.RESOLVE,
    UNIT_STEP.CLASSIFY,
    UNIT_STEP.SEQUENCES,
    UNIT_STEP.APPLY,
    ...(linkAddressMaster
      ? [UNIT_STEP.ADDRESS_SEQUENCES, UNIT_STEP.ADDRESS_CLASSIFY, UNIT_STEP.ADDRESS_APPLY, UNIT_STEP.ADDRESS_VERIFY]
      : []),
    UNIT_STEP.ANALYZE,
    UNIT_STEP.REPORT,
    dryRun ? UNIT_STEP.ROLLBACK : UNIT_STEP.COMMIT,
  ];
}
