import { Activity, ChartColumn, ClipboardCheck, Table2 } from "lucide-react";
import type { WizardStepDef } from "@/ui-kit/types/ui";
import { canContinue, CompletarStep, type CompletarWizardState } from "./completarUnidadTerritorialWizardState";

interface StepDef {
  step: CompletarStep;
  title: string;
  subtitle: string;
  icon: WizardStepDef["icon"];
}

const STEP_DEFS: readonly StepDef[] = [
  {
    step: CompletarStep.TABLES,
    title: "Tablas",
    subtitle: "Tabla de unidades territoriales y tabla de direcciones maestras.",
    icon: Table2,
  },
  {
    step: CompletarStep.REVIEW,
    title: "Revisar",
    subtitle: "Revise el resumen antes de analizar o completar.",
    icon: ClipboardCheck,
  },
  {
    step: CompletarStep.RUN,
    title: "Ejecución",
    subtitle: "Progreso de la creación y el enlace de direcciones maestras.",
    icon: Activity,
  },
  {
    step: CompletarStep.REPORT,
    title: "Informe",
    subtitle: "Resultado en las unidades territoriales y las direcciones maestras.",
    icon: ChartColumn,
  },
];

export const completarStepIdOf = (step: CompletarStep): number => STEP_DEFS.findIndex((def) => def.step === step) + 1;

export const completarStepOfId = (id: number): CompletarStep => STEP_DEFS[id - 1]?.step ?? CompletarStep.TABLES;

export function buildCompletarWizardSteps(state: CompletarWizardState): WizardStepDef[] {
  const currentId = completarStepIdOf(state.step);
  return STEP_DEFS.map((def, index) => ({
    id: index + 1,
    title: def.title,
    subtitle: def.subtitle,
    icon: def.icon,
    content: null,
    canProceed: index + 1 === currentId && canContinue(state),
  }));
}
