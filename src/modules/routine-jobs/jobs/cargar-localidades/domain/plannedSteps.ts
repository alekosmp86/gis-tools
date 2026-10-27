export const LOCALITY_STEP = {
  VALIDATE: "Validar tablas y columnas",
  TARGETS: "Validar tablas de destino",
  COUNT: "Contar filas de origen",
  RESOLVE: "Resolver provincias y localidades",
  SEQUENCES: "Ajustar secuencias de destino",
  ANALYZE: "Analizar tablas de destino",
  REPORT: "Generar informe",
  COMMIT: "Confirmar cambios",
  ROLLBACK: "Revertir cambios de la simulación",
} as const;

export const classifyStepLabel = (table: string): string => `Clasificar localidades: ${table}`;

export const applyStepLabel = (table: string): string => `Aplicar cambios: ${table}`;

export interface LocalityPlannedStepsInput {
  dryRun: boolean;
  tables: readonly string[];
}

export function plannedLocalityStepLabels({ dryRun, tables }: LocalityPlannedStepsInput): string[] {
  return [
    LOCALITY_STEP.VALIDATE,
    LOCALITY_STEP.TARGETS,
    LOCALITY_STEP.COUNT,
    LOCALITY_STEP.RESOLVE,
    ...tables.map(classifyStepLabel),
    LOCALITY_STEP.SEQUENCES,
    ...tables.map(applyStepLabel),
    LOCALITY_STEP.ANALYZE,
    LOCALITY_STEP.REPORT,
    dryRun ? LOCALITY_STEP.ROLLBACK : LOCALITY_STEP.COMMIT,
  ];
}
