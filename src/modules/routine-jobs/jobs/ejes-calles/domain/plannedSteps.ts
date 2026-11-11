export const EJES_STEP = {
  VALIDATE: "Validar tablas y columnas",
  PRIVILEGES: "Comprobar privilegios",
  STAGING: "Revisar los ejes de origen",
  ANALYZE: "Clasificar los tramos y calcular cloc_iso",
} as const;

export const plannedEjesStepLabels = (): string[] => Object.values(EJES_STEP);
