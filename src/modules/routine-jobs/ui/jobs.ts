export interface RoutineJob {
  id: string;
  title: string;
  description: string;
}

export const ROUTINE_JOBS: readonly RoutineJob[] = [
  {
    id: "cargar-padrones",
    title: "Cargar padrones",
    description:
      "Carga mensual del padrón a partir de las tablas catastrales rural y urbana ya cargadas con la sincronización de shapefiles.",
  },
  {
    id: "actualizar-padron",
    title: "Actualizar padrones de carto",
    description:
      "Rellena una tabla de trabajo con los padrones de la tabla de staging, con provincias y localidades resueltas. No modifica carto.padron.",
  },
];
