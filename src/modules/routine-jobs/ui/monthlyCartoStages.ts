export const MonthlyStage = {
  CARGAR_PADRONES: "cargar-padrones",
  CARGAR_LOCALIDADES: "cargar-localidades",
  UNIDAD_TERRITORIAL: "unidad-territorial",
  ACTUALIZAR_PADRON: "actualizar-padron",
} as const;

export type MonthlyStage = (typeof MonthlyStage)[keyof typeof MonthlyStage];

export interface MonthlyStageDef {
  id: MonthlyStage;
  title: string;
  description: string;
}

export const MONTHLY_STAGES: readonly MonthlyStageDef[] = [
  {
    id: MonthlyStage.CARGAR_PADRONES,
    title: "Cargar padrones",
    description: "Carga el padrón rural y urbano en la tabla de staging de padrones.",
  },
  {
    id: MonthlyStage.CARGAR_LOCALIDADES,
    title: "Cargar localidades",
    description: "Inserta las localidades nuevas y actualiza las geometrías cambiadas.",
  },
  {
    id: MonthlyStage.UNIDAD_TERRITORIAL,
    title: "Actualizar unidades territoriales",
    description: "Inserta las unidades territoriales nuevas y actualiza su fuente y geometría desde las localidades catastrales. Con la opción de direcciones maestras, también crea y enlaza la de cada unidad sin una.",
  },
  {
    id: MonthlyStage.ACTUALIZAR_PADRON,
    title: "Actualizar padrones",
    description: "Inserta los padrones nuevos y actualiza las geometrías cambiadas en la tabla de destino, sin borrar filas ni cambiar ids. Con la opción de direcciones maestras, también crea y enlaza las de los padrones sin una.",
  },
];
