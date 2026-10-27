export interface RoutineJob {
  id: string;
  title: string;
  description: string;
}

export const MONTHLY_CARTO_JOB_ID = "actualizacion-mensual-carto";

export const ROUTINE_JOBS: readonly RoutineJob[] = [
  {
    id: MONTHLY_CARTO_JOB_ID,
    title: "Actualización mensual de carto",
    description:
      "Carga mensual de padrones y actualización de carto, en etapas ordenadas. Abra cada etapa y revise su informe antes de seguir.",
  },
];
