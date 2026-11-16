export const EJES_STEP = {
  VALIDATE: "Validar tablas y columnas",
  PRIVILEGES: "Comprobar privilegios",
  STAGING: "Revisar los ejes de origen",
  ANALYZE: "Clasificar los tramos y calcular cloc_iso",
  LOCK: "Bloquear las tablas de destino",
  SEQUENCES: "Ajustar las secuencias",
  SELECT: "Preparar los tramos a aplicar",
  BACKUP: "Generar el respaldo para revertir",
  WAYS: "Insertar las vías nuevas",
  SECTIONS: "Insertar los tramos nuevos y sus direcciones maestras",
  UPDATES: "Actualizar los tramos con cambios",
  RENUMBER: "Aplicar los tramos renumerados y mover sus puntos de acceso",
  REMOVE: "Quitar los tramos unidos y sin reemplazo aceptados",
  ANALYZE_TABLES: "Analizar las tablas modificadas",
  COMMIT: "Confirmar la transacción",
} as const;

const DRY_RUN_STEPS = [EJES_STEP.VALIDATE, EJES_STEP.PRIVILEGES, EJES_STEP.STAGING, EJES_STEP.ANALYZE];

const REAL_RUN_STEPS = [
  EJES_STEP.VALIDATE,
  EJES_STEP.PRIVILEGES,
  EJES_STEP.LOCK,
  EJES_STEP.STAGING,
  EJES_STEP.ANALYZE,
  EJES_STEP.SEQUENCES,
  EJES_STEP.SELECT,
  EJES_STEP.BACKUP,
  EJES_STEP.WAYS,
  EJES_STEP.SECTIONS,
  EJES_STEP.UPDATES,
  EJES_STEP.RENUMBER,
  EJES_STEP.REMOVE,
  EJES_STEP.ANALYZE_TABLES,
  EJES_STEP.COMMIT,
];

export const plannedEjesStepLabels = (dryRun = true): string[] => [...(dryRun ? DRY_RUN_STEPS : REAL_RUN_STEPS)];
