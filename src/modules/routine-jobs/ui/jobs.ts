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
];
