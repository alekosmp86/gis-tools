import { Activity, ChartColumn, ClipboardCheck, SlidersHorizontal, Table2 } from "lucide-react";
import type { WizardStepDef } from "@/ui-kit/types/ui";
import { canContinue, LocalidadesStep, type LocalidadesWizardState } from "./cargarLocalidadesWizardState";

interface StepDef {
  step: LocalidadesStep;
  title: string;
  subtitle: string;
  icon: WizardStepDef["icon"];
}

const STEP_DEFS: readonly StepDef[] = [
  {
    step: LocalidadesStep.TABLES,
    title: "Tablas",
    subtitle: "Padrones y localidades de origen, provincias y una o dos tablas de localidades destino.",
    icon: Table2,
  },
  {
    step: LocalidadesStep.OPTIONS,
    title: "Opciones",
    subtitle: "Tolerancia de comparación y actualización de geometrías.",
    icon: SlidersHorizontal,
  },
  {
    step: LocalidadesStep.REVIEW,
    title: "Revisar",
    subtitle: "Revise el resumen antes de analizar o cargar.",
    icon: ClipboardCheck,
  },
  {
    step: LocalidadesStep.RUN,
    title: "Ejecución",
    subtitle: "Progreso de la carga de localidades.",
    icon: Activity,
  },
  {
    step: LocalidadesStep.REPORT,
    title: "Informe",
    subtitle: "Resultado por tabla de localidades destino.",
    icon: ChartColumn,
  },
];

export const localidadesStepIdOf = (step: LocalidadesStep): number => STEP_DEFS.findIndex((def) => def.step === step) + 1;

export const localidadesStepOfId = (id: number): LocalidadesStep => STEP_DEFS[id - 1]?.step ?? LocalidadesStep.TABLES;

export function buildLocalidadesWizardSteps(state: LocalidadesWizardState): WizardStepDef[] {
  const currentId = localidadesStepIdOf(state.step);
  return STEP_DEFS.map((def, index) => ({
    id: index + 1,
    title: def.title,
    subtitle: def.subtitle,
    icon: def.icon,
    content: null,
    canProceed: index + 1 === currentId && canContinue(state),
  }));
}
