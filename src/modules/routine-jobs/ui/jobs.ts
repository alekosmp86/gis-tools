export interface RoutineJob {
  id: string;
  title: string;
  description: string;
}

export const MONTHLY_CARTO_JOB_ID = "actualizacion-mensual-carto";
export const EJES_CALLES_JOB_ID = "ejes-calles";
export const CENTROS_ANEP_JOB_ID = "centros-anep";

export const ROUTINE_JOBS: readonly RoutineJob[] = [
  {
    id: MONTHLY_CARTO_JOB_ID,
    title: "Carga de padrones",
    description:
      "Carga mensual de padrones y actualización de carto, en etapas ordenadas. Abra cada etapa y revise su informe antes de seguir.",
  },
  {
    id: EJES_CALLES_JOB_ID,
    title: "Carga de ejes de calles",
    description:
      "Analiza los ejes de vía de circulación cargados en la tabla de paso y los compara con los tramos de calle de carto, sin modificar ninguna tabla.",
  },
  {
    id: CENTROS_ANEP_JOB_ID,
    title: "Carga de centros ANEP",
    description:
      "Reemplaza los centros educativos de ANEP de carto con los de la tabla de paso, que se carga antes desde el shapefile del WFS de IDEuy.",
  },
];
