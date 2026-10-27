import { Activity, ChartColumn, ClipboardCheck, SlidersHorizontal, Table2 } from "lucide-react";
import type { WizardStepDef } from "@/ui-kit/types/ui";
import { canContinue, UnidadStep, type UnidadTerritorialWizardState } from "./unidadTerritorialWizardState";

interface StepDef {
  step: UnidadStep;
  title: string;
  subtitle: string;
  icon: WizardStepDef["icon"];
}

const STEP_DEFS: readonly StepDef[] = [
  {
    step: UnidadStep.TABLES,
    title: "Tablas",
    subtitle: "Localidades catastrales de origen, tipos de unidad y tabla de unidades territoriales destino.",
    icon: Table2,
  },
  {
    step: UnidadStep.OPTIONS,
    title: "Opciones",
    subtitle: "Tipo de localidad, tolerancia de comparación y actualización de geometrías.",
    icon: SlidersHorizontal,
  },
  {
    step: UnidadStep.REVIEW,
    title: "Revisar",
    subtitle: "Revise el resumen antes de analizar o actualizar.",
    icon: ClipboardCheck,
  },
  {
    step: UnidadStep.RUN,
    title: "Ejecución",
    subtitle: "Progreso de la actualización de unidades territoriales.",
    icon: Activity,
  },
  {
    step: UnidadStep.REPORT,
    title: "Informe",
    subtitle: "Resultado de la tabla de unidades territoriales.",
    icon: ChartColumn,
  },
];

export const unidadStepIdOf = (step: UnidadStep): number => STEP_DEFS.findIndex((def) => def.step === step) + 1;

export const unidadStepOfId = (id: number): UnidadStep => STEP_DEFS[id - 1]?.step ?? UnidadStep.TABLES;

export function buildUnidadWizardSteps(state: UnidadTerritorialWizardState): WizardStepDef[] {
  const currentId = unidadStepIdOf(state.step);
  return STEP_DEFS.map((def, index) => ({
    id: index + 1,
    title: def.title,
    subtitle: def.subtitle,
    icon: def.icon,
    content: null,
    canProceed: index + 1 === currentId && canContinue(state),
  }));
}
