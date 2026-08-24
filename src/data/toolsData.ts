import { GitCompare, FileCode, Database, Cpu } from "lucide-react";
import { ToolCategory } from "@/types/gis";
import { BadgeVariant } from "@/types/ui";
import type { ToolCardData } from "@/types/gis";

export const toolCategories: string[] = [
  ToolCategory.ALL,
  ToolCategory.SYNC,
  ToolCategory.CONVERTERS,
  ToolCategory.DATABASE,
];

export const toolsList: ToolCardData[] = [
  {
    id: "gis-sync",
    title: "Sincronización de Datos DB vs. Shapefile",
    category: ToolCategory.SYNC,
    badge: { label: "Herramienta Principal", type: BadgeVariant.DEV },
    icon: GitCompare,
    description:
      "Correlacione tablas de atributos de bases de datos contra capas Shapefile/GeoJSON. Destaque discrepancias en un mapa interactivo y genere scripts de actualización SQL para PostGIS.",
    tags: ["Shapefile", "PostGIS", "Turf.js", "Leaflet"],
    actionLabel: "Iniciar Herramienta",
    enabled: true,
  },
  {
    id: "spatial-converter",
    title: "Conversor de Formatos Espaciales",
    category: ToolCategory.CONVERTERS,
    badge: { label: "Planificado", type: BadgeVariant.PLANNED },
    icon: FileCode,
    description:
      "Convierta formatos espaciales en lote en el navegador entre Shapefile (.shp), KML, GeoJSON y WKT sin enviar datos a servidores externos.",
    tags: ["GeoJSON", "Shapefile", "KML", "WKT"],
    actionLabel: "Próximamente",
    enabled: false,
  },
  {
    id: "postgis-patcher",
    title: "Generador de Parches SQL PostGIS",
    category: ToolCategory.DATABASE,
    badge: { label: "Planificado", type: BadgeVariant.PLANNED },
    icon: Database,
    description:
      "Genere parches de migración ST_GeomFromGeoJSON optimizados y tablas de auditoría a partir de registros de cambios geométricos.",
    tags: ["PostgreSQL", "PostGIS", "SQL"],
    actionLabel: "Próximamente",
    enabled: false,
  },
  {
    id: "spatial-joiner",
    title: "Unión de Atributos Espaciales",
    category: ToolCategory.SYNC,
    badge: { label: "Planificado", type: BadgeVariant.PLANNED },
    icon: Cpu,
    description:
      "Realice uniones espaciales entre capas de punto en polígono y mapee esquemas de campos no coincidentes automáticamente por centroides.",
    tags: ["Unión Espacial", "Centroide", "Turf.js"],
    actionLabel: "Próximamente",
    enabled: false,
  },
];
