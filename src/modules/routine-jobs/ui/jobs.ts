export interface RoutineJob {
  id: string;
  title: string;
  description: string;
}

export const MONTHLY_CARTO_JOB_ID = "actualizacion-mensual-carto";
export const EJES_CALLES_JOB_ID = "ejes-calles";

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
];
