import { Database, FileUp, GitMerge, BarChart3 } from "lucide-react";
import type { StepItemData } from "@/types/gis";

export const WIZARD_STEPS: StepItemData[] = [
  {
    id: 1,
    title: "Base de Datos",
    subtitle: "Conexión y Tabla",
    icon: Database,
  },
  {
    id: 2,
    title: "Capa Espacial",
    subtitle: "Upload Shapefile (.zip)",
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
    subtitle: "Discrepancias y Mapa",
    icon: BarChart3,
  },
];
