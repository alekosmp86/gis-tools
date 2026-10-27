export const MonthlyStage = {
  CARGAR_PADRONES: "cargar-padrones",
  CARGAR_LOCALIDADES: "cargar-localidades",
  UNIDAD_TERRITORIAL: "unidad-territorial",
  ACTUALIZAR_PADRON: "actualizar-padron",
  APLICAR_PADRON: "aplicar-padron",
} as const;

export type MonthlyStage = (typeof MonthlyStage)[keyof typeof MonthlyStage];

export interface MonthlyStageDef {
  id: MonthlyStage;
  title: string;
  description: string;
  available: boolean;
}

export const MONTHLY_STAGES: readonly MonthlyStageDef[] = [
  {
    id: MonthlyStage.CARGAR_PADRONES,
    title: "Cargar padrones",
    description: "Carga el padrón rural y urbano en la tabla de staging de padrones.",
    available: true,
  },
  {
    id: MonthlyStage.CARGAR_LOCALIDADES,
    title: "Cargar localidades",
    description: "Inserta las localidades nuevas y actualiza las geometrías cambiadas.",
    available: true,
  },
  {
    id: MonthlyStage.UNIDAD_TERRITORIAL,
    title: "Actualizar unidades territoriales",
    description: "Inserta las unidades territoriales nuevas y actualiza su fuente y geometría desde las localidades catastrales.",
    available: true,
  },
  {
    id: MonthlyStage.ACTUALIZAR_PADRON,
    title: "Actualizar padrones",
    description: "Resuelve los padrones de la tabla de staging y rellena la tabla de trabajo.",
    available: true,
  },
  {
    id: MonthlyStage.APLICAR_PADRON,
    title: "Aplicar padrones",
    description: "Inserta los padrones nuevos y actualiza sus geometrías en la tabla padrón.",
    available: false,
  },
];
