import { GitCompare, FileSpreadsheet, Eye } from "lucide-react";
import { ToolCategory } from "@/types/gis";
import { BadgeVariant } from "@/types/ui";
import type { ToolCardData } from "@/types/gis";

export const toolCategories: string[] = [
  ToolCategory.ALL,
  ToolCategory.SYNC,
  ToolCategory.VIEWERS,
];

export const toolsList: ToolCardData[] = [
  {
    id: "gis-sync",
    title: "Sincronización de Datos DB vs. Shapefile",
    category: ToolCategory.SYNC,
    badge: { label: "Herramienta Principal", type: BadgeVariant.DEV },
    icon: GitCompare,
    description:
      "Correlacione tablas de atributos de bases de datos contra capas Shapefile/GeoJSON. Destaque discrepancias y genere scripts de actualización SQL para PostGIS.",
    tags: ["Shapefile", "PostGIS", "GeoJSON", "Topología"],
    actionLabel: "Iniciar Herramienta",
    enabled: true,
    route: "/tools/db-shapefile-sync",
  },
  {
    id: "db-csv-sync",
    title: "Sincronización de Datos DB vs. CSV",
    category: ToolCategory.SYNC,
    badge: { label: "Herramienta Activa", type: BadgeVariant.ACTIVE },
    icon: FileSpreadsheet,
    description:
      "Correlacione registros PostGIS contra archivos alfanuméricos CSV. Identifique descalces de atributos y genere parches SQL de actualización.",
    tags: ["CSV", "PostGIS", "Atributos", "SQL"],
    actionLabel: "Iniciar Herramienta",
    enabled: true,
    route: "/tools/db-csv-sync",
  },
  {
    id: "file-viewer",
    title: "Visor de Archivos Espaciales",
    category: ToolCategory.VIEWERS,
    badge: { label: "Nueva Herramienta", type: BadgeVariant.ACTIVE },
    icon: Eye,
    description:
      "Visualice interactivamente entidades geográficas y tablas de atributos a partir de archivos Shapefile (.zip), GeoJSON o CSV.",
    tags: ["Shapefile", "GeoJSON", "CSV", "Visor Mapa"],
    actionLabel: "Iniciar Herramienta",
    enabled: true,
    route: "/tools/file-viewer",
  },
];
