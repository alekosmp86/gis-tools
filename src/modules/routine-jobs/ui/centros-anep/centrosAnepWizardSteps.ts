import { ChartColumn, ClipboardCheck, Plug, Table2 } from "lucide-react";
import type { WizardStepDef } from "@/ui-kit/types/ui";
import { canContinue, CentrosAnepStep, type CentrosAnepWizardState } from "./centrosAnepWizardState";

interface StepDef {
  step: CentrosAnepStep;
  title: string;
  subtitle: string;
  icon: WizardStepDef["icon"];
}

const STEP_DEFS: readonly StepDef[] = [
  {
    step: CentrosAnepStep.CONNECTION,
    title: "Conexión",
    subtitle: "Servidor, base de datos y usuario. La contraseña no se guarda en el perfil.",
    icon: Plug,
  },
  {
    step: CentrosAnepStep.TABLES,
    title: "Tablas",
    subtitle: "La tabla de staging y la tabla final de centros ANEP, con su esquema.",
    icon: Table2,
  },
  {
    step: CentrosAnepStep.REVIEW,
    title: "Revisar",
    subtitle: "Revise el resumen, analice y, si no hay bloqueos, cargue.",
    icon: ClipboardCheck,
  },
  {
    step: CentrosAnepStep.RESULT,
    title: "Resultado",
    subtitle: "Progreso de la ejecución y su informe.",
    icon: ChartColumn,
  },
];

export const centrosAnepStepIdOf = (step: CentrosAnepStep): number =>
  STEP_DEFS.findIndex((def) => def.step === step) + 1;

export const centrosAnepStepOfId = (id: number): CentrosAnepStep =>
  STEP_DEFS[id - 1]?.step ?? CentrosAnepStep.CONNECTION;

export function buildCentrosAnepWizardSteps(state: CentrosAnepWizardState): WizardStepDef[] {
  const currentId = centrosAnepStepIdOf(state.step);
  return STEP_DEFS.map((def, index) => ({
    id: index + 1,
    title: def.title,
    subtitle: def.subtitle,
    icon: def.icon,
    content: null,
    canProceed: index + 1 === currentId && canContinue(state),
  }));
}
