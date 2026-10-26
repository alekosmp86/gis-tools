import { ChartColumn, ClipboardCheck, Plug, SlidersHorizontal, Table2 } from "lucide-react";
import type { WizardStepDef } from "@/ui-kit/types/ui";
import type { TableRole } from "../jobs/cargar-padrones/constants";
import { TABLE_ROLE } from "../jobs/cargar-padrones/constants";
import { canContinue, WizardStep, type WizardState } from "./cargarPadronesWizardState";

export { initialStepFor } from "./cargarPadronesWizardState";

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
    subtitle: "Esquema y las tres tablas: rural, urbana y destino.",
    icon: Table2,
  },
  {
    step: WizardStep.OPTIONS,
    title: "Opciones",
    subtitle: "Cómo se vacía la tabla destino y qué correcciones se aplican.",
    icon: SlidersHorizontal,
  },
  {
    step: WizardStep.REVIEW,
    title: "Revisar",
    subtitle: "Revise el resumen antes de analizar o cargar.",
    icon: ClipboardCheck,
  },
  {
    step: WizardStep.RESULT,
    title: "Resultado",
    subtitle: "Progreso de la carga y su informe.",
    icon: ChartColumn,
  },
];

const ROLES: readonly TableRole[] = [TABLE_ROLE.RURAL, TABLE_ROLE.URBANO, TABLE_ROLE.TARGET];

export const stepIdOf = (step: WizardStep): number => STEP_DEFS.findIndex((def) => def.step === step) + 1;

export const stepOfId = (id: number): WizardStep => STEP_DEFS[id - 1]?.step ?? WizardStep.CONNECTION;

export function buildWizardSteps(state: WizardState): WizardStepDef[] {
  const currentId = stepIdOf(state.step);
  return STEP_DEFS.map((def, index) => ({
    id: index + 1,
    title: def.title,
    subtitle: def.subtitle,
    icon: def.icon,
    content: null,
    canProceed: index + 1 === currentId && canContinue(state),
  }));
}

export function excludedFor(state: WizardState): Record<TableRole, string[]> {
  const chosen = (role: TableRole): string => state.tables[role].trim();
  const exclusionsOf = (role: TableRole): string[] => {
    const others = ROLES.filter((other) => other !== role).map(chosen);
    return [...new Set(others.filter((name) => name !== ""))];
  };
  return {
    rural: exclusionsOf(TABLE_ROLE.RURAL),
    urbano: exclusionsOf(TABLE_ROLE.URBANO),
    target: exclusionsOf(TABLE_ROLE.TARGET),
  };
}
