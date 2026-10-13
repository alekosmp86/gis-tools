import { ClipboardCheck, FileSpreadsheet, FileUp, PlugZap } from "lucide-react";
import type { WizardStepDef } from "@/ui-kit/types/ui";
import { FlowStep } from "../domain/loadFlow";

/** The four steps of the stepper. The panel renders the content itself, so `content` stays empty. */
export const INDICATORS_STEPS: ReadonlyArray<WizardStepDef> = [
  { id: FlowStep.CONNECTION, title: "Conexión", subtitle: "Base de datos", icon: PlugZap, content: null },
  { id: FlowStep.FILES, title: "Archivos", subtitle: "IndicadoresLTE", icon: FileUp, content: null },
  { id: FlowStep.REVIEW, title: "Revisión", subtitle: "Plan de carga", icon: ClipboardCheck, content: null },
  { id: FlowStep.RESULT, title: "Resultado", subtitle: "Reportes", icon: FileSpreadsheet, content: null },
];
