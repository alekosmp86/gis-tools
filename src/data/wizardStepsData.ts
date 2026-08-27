import { Database, FileUp, GitMerge, BarChart3 } from "lucide-react";
import type { StepItemData } from "@/types/ui";

export function getWizardSteps(
  fileStepTitle = "Capa Espacial",
  fileStepSubtitle = "Cargar Shapefile (.zip)",
  step1Title = "Base de Datos",
  step1Subtitle = "Conexión y Tabla"
): StepItemData[] {
  return [
    {
      id: 1,
      title: step1Title,
      subtitle: step1Subtitle,
      icon: Database,
    },
    {
      id: 2,
      title: fileStepTitle,
      subtitle: fileStepSubtitle,
      icon: FileUp,
    },
    {
      id: 3,
      title: "Mapeo SUID",
      subtitle: "Identificador y Atributos",
      icon: GitMerge,
    },
    {
      id: 4,
      title: "Resultados",
      subtitle: "Discrepancias y Script",
      icon: BarChart3,
    },
  ];
}
