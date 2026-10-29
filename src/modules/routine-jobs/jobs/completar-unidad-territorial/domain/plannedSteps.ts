export const COMPLETAR_STEP = {
  VALIDATE: "Validar tablas y columnas",
  TARGETS: "Validar tablas de destino",
  CLASSIFY: "Clasificar unidades sin dirección maestra",
  SEQUENCES: "Ajustar secuencia de direcciones maestras",
  APPLY: "Crear y enlazar direcciones maestras",
  VERIFY: "Verificar unidades pendientes",
  ANALYZE: "Analizar tablas de destino",
  REPORT: "Generar informe",
  COMMIT: "Confirmar cambios",
  ROLLBACK: "Revertir cambios de la simulación",
} as const;

export interface CompletarPlannedStepsInput {
  dryRun: boolean;
}

export function plannedCompletarStepLabels({ dryRun }: CompletarPlannedStepsInput): string[] {
  return [
    COMPLETAR_STEP.VALIDATE,
    COMPLETAR_STEP.TARGETS,
    COMPLETAR_STEP.SEQUENCES,
    COMPLETAR_STEP.CLASSIFY,
    COMPLETAR_STEP.APPLY,
    COMPLETAR_STEP.VERIFY,
    COMPLETAR_STEP.ANALYZE,
    COMPLETAR_STEP.REPORT,
    dryRun ? COMPLETAR_STEP.ROLLBACK : COMPLETAR_STEP.COMMIT,
  ];
}
