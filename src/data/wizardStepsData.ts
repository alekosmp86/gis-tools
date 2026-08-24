import { Database, FileUp, GitMerge, BarChart3 } from "lucide-react";
import type { StepItemData } from "@/types/gis";

export function getWizardSteps(
  fileStepTitle = "Capa Espacial",
  fileStepSubtitle = "Cargar Shapefile (.zip)"
): StepItemData[] {
  return [
    {
      id: 1,
      title: "Base de Datos",
      subtitle: "Conexión y Tabla",
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
