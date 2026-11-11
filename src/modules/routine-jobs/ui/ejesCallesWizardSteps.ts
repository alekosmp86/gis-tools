import { ChartColumn, ClipboardCheck, Plug, Table2 } from "lucide-react";
import type { WizardStepDef } from "@/ui-kit/types/ui";
import { canContinue, EjesStep, type EjesWizardState } from "./ejesCallesWizardState";

interface StepDef {
  step: EjesStep;
  title: string;
  subtitle: string;
  icon: WizardStepDef["icon"];
}

const STEP_DEFS: readonly StepDef[] = [
  {
    step: EjesStep.CONNECTION,
    title: "Conexión",
    subtitle: "Servidor, base de datos y usuario. La contraseña no se guarda en el perfil.",
    icon: Plug,
  },
  {
    step: EjesStep.TABLES,
    title: "Tablas",
    subtitle: "Los ejes de origen, las tablas de carto que se cargan y las de referencia, con su esquema.",
    icon: Table2,
  },
  {
    step: EjesStep.REVIEW,
    title: "Revisar",
    subtitle: "Revise el resumen y analice: el análisis no modifica la base de datos.",
    icon: ClipboardCheck,
  },
  {
    step: EjesStep.RESULT,
    title: "Resultado",
    subtitle: "Progreso del análisis y su informe.",
    icon: ChartColumn,
  },
];

export const ejesStepIdOf = (step: EjesStep): number => STEP_DEFS.findIndex((def) => def.step === step) + 1;

export const ejesStepOfId = (id: number): EjesStep => STEP_DEFS[id - 1]?.step ?? EjesStep.CONNECTION;

export function buildEjesWizardSteps(state: EjesWizardState): WizardStepDef[] {
  const currentId = ejesStepIdOf(state.step);
  return STEP_DEFS.map((def, index) => ({
    id: index + 1,
    title: def.title,
    subtitle: def.subtitle,
    icon: def.icon,
    content: null,
    canProceed: index + 1 === currentId && canContinue(state),
  }));
}
