import { ChartColumn, ClipboardCheck, Plug, SlidersHorizontal, Table2 } from "lucide-react";
import type { WizardStepDef } from "@/ui-kit/types/ui";
import { canContinue, WizardStep, type ActualizarWizardState } from "./actualizarPadronWizardState";

interface StepDef {
  step: WizardStep;
  title: string;
  subtitle: string;
  icon: WizardStepDef["icon"];
}

const STEP_DEFS: readonly StepDef[] = [
  {
    step: WizardStep.CONNECTION,
    title: "Conexión",
    subtitle: "Servidor, base de datos y usuario. La contraseña no se guarda en el perfil.",
    icon: Plug,
  },
  {
    step: WizardStep.TABLES,
    title: "Tablas",
    subtitle: "Dos esquemas y las tablas: origen, destino, provincias, localidades, tipos y direcciones maestras (opcionales).",
    icon: Table2,
  },
  {
    step: WizardStep.OPTIONS,
    title: "Opciones",
    subtitle: "Tipo de localidad, tolerancia y si se actualizan las geometrías existentes.",
    icon: SlidersHorizontal,
  },
  {
    step: WizardStep.REVIEW,
    title: "Revisar",
    subtitle: "Revise el resumen antes de analizar o actualizar.",
    icon: ClipboardCheck,
  },
  {
    step: WizardStep.RESULT,
    title: "Resultado",
    subtitle: "Progreso de la actualización y su informe.",
    icon: ChartColumn,
  },
];

export const actualizarStepIdOf = (step: WizardStep): number => STEP_DEFS.findIndex((def) => def.step === step) + 1;

export const actualizarStepOfId = (id: number): WizardStep => STEP_DEFS[id - 1]?.step ?? WizardStep.CONNECTION;

export function buildActualizarWizardSteps(state: ActualizarWizardState): WizardStepDef[] {
  const currentId = actualizarStepIdOf(state.step);
  return STEP_DEFS.map((def, index) => ({
    id: index + 1,
    title: def.title,
    subtitle: def.subtitle,
    icon: def.icon,
    content: null,
    canProceed: index + 1 === currentId && canContinue(state),
  }));
}
