export const CENTROS_STEP = {
  VALIDATE: "Validar tablas y columnas",
  PRIVILEGES: "Comprobar privilegios",
  LOCK: "Bloquear la tabla final",
  STAGING: "Revisar los centros de origen",
  COMPARE: "Comparar con la tabla final",
  BACKUP: "Escribir el respaldo para revertir",
  DELETE: "Vaciar la tabla final",
  INSERT: "Insertar los centros de origen",
  ANALYZE: "Actualizar estadísticas (ANALYZE)",
  COMMIT: "Confirmar cambios",
} as const;

export interface CentrosPlannedStepsInput {
  dryRun: boolean;
}

export function plannedCentrosStepLabels({ dryRun }: CentrosPlannedStepsInput): string[] {
  if (dryRun) {
    return [CENTROS_STEP.VALIDATE, CENTROS_STEP.PRIVILEGES, CENTROS_STEP.STAGING, CENTROS_STEP.COMPARE];
  }
  return [
    CENTROS_STEP.VALIDATE,
    CENTROS_STEP.PRIVILEGES,
    CENTROS_STEP.LOCK,
    CENTROS_STEP.STAGING,
    CENTROS_STEP.COMPARE,
    CENTROS_STEP.BACKUP,
    CENTROS_STEP.DELETE,
    CENTROS_STEP.INSERT,
    CENTROS_STEP.ANALYZE,
    CENTROS_STEP.COMMIT,
  ];
}
