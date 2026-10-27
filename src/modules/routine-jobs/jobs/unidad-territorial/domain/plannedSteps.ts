export const UNIT_STEP = {
  VALIDATE: "Validar tablas, columnas y tipo de unidad",
  TARGET: "Validar tabla de destino",
  COUNT: "Contar filas de origen",
  RESOLVE: "Resolver localidades de origen",
  CLASSIFY: "Clasificar unidades territoriales",
  SEQUENCES: "Ajustar secuencias de destino",
  APPLY: "Aplicar cambios de unidades territoriales",
  ANALYZE: "Analizar tabla de destino",
  REPORT: "Generar informe",
  COMMIT: "Confirmar cambios",
  ROLLBACK: "Revertir cambios de la simulación",
} as const;

export interface UnitPlannedStepsInput {
  dryRun: boolean;
}

export function plannedUnitStepLabels({ dryRun }: UnitPlannedStepsInput): string[] {
  return [
    UNIT_STEP.VALIDATE,
    UNIT_STEP.TARGET,
    UNIT_STEP.COUNT,
    UNIT_STEP.RESOLVE,
    UNIT_STEP.CLASSIFY,
    UNIT_STEP.SEQUENCES,
    UNIT_STEP.APPLY,
    UNIT_STEP.ANALYZE,
    UNIT_STEP.REPORT,
    dryRun ? UNIT_STEP.ROLLBACK : UNIT_STEP.COMMIT,
  ];
}
