import { GitCompare, FileSpreadsheet, Eye, Database } from "lucide-react";
import { ToolCategory, type ToolCardData } from "@/types/ui";
import { BadgeVariant } from "@/types/ui";

export const toolCategories: string[] = [
  ToolCategory.ALL,
  ToolCategory.SYNC,
  ToolCategory.VIEWERS,
  ToolCategory.DATABASE
];

export const toolsList: ToolCardData[] = [
  {
    id: "gis-sync",
    title: "Sincronización de Datos DB vs. Shapefile",
    category: [ToolCategory.SYNC],
    badge: { label: "Activa", type: BadgeVariant.ACTIVE },
    icon: GitCompare,
    description:
      "Correlacione tablas de atributos de bases de datos contra capas Shapefile/GeoJSON. Destaque discrepancias y genere scripts de actualización SQL para PostGIS.",
    tags: ["Shapefile", "PostGIS", "GeoJSON", "Topología"],
    enabled: true,
    route: "/tools/db-shapefile-sync",
  },
  {
    id: "db-csv-sync",
    title: "Sincronización de Datos DB vs. CSV",
    category: [ToolCategory.SYNC],
    badge: { label: "Activa", type: BadgeVariant.ACTIVE },
    icon: FileSpreadsheet,
    description:
      "Correlacione registros PostGIS contra archivos alfanuméricos CSV. Identifique descalces de atributos y genere parches SQL de actualización.",
    tags: ["CSV", "PostGIS", "Atributos", "SQL"],
    enabled: true,
    route: "/tools/db-csv-sync",
  },
  {
    id: "db-db-sync",
    title: "Sincronización de Datos DB vs. DB (Réplicas)",
    category: [ToolCategory.DATABASE, ToolCategory.SYNC],
    badge: { label: "Activa", type: BadgeVariant.ACTIVE },
    icon: Database,
    description:
      "Correlacione registros entre dos tablas de bases de datos PostgreSQL/PostGIS (incluso en distintas bases de datos o esquemas), analice discrepancias y genere parches SQL.",
    tags: ["PostgreSQL", "PostGIS", "Réplicas", "SQL"],
    enabled: true,
    route: "/tools/db-db-sync",
  },
  {
    id: "file-viewer",
    title: "Visor de Archivos Espaciales",
    category: [ToolCategory.VIEWERS],
    badge: { label: "Activa", type: BadgeVariant.ACTIVE },
    icon: Eye,
    description:
      "Visualice interactivamente entidades geográficas y tablas de atributos a partir de archivos Shapefile (.zip), GeoJSON o CSV.",
    tags: ["Shapefile", "GeoJSON", "CSV", "Visor Mapa"],
    enabled: true,
    route: "/tools/file-viewer",
  },
  {
    id: "db-table-viewer",
    title: "Visor de Tabla PostGIS / PostgreSQL",
    category: [ToolCategory.VIEWERS, ToolCategory.DATABASE],
    badge: { label: "Activa", type: BadgeVariant.ACTIVE },
    icon: Eye,
    description:
      "Conéctese a cualquier tabla de PostgreSQL/PostGIS para visualizar sus geometrías espaciales en el mapa interactivo de Leaflet, inspeccionar metadatos y consultar sus atributos en una tabla paginada.",
    tags: ["PostgreSQL", "PostGIS", "Visor Mapa", "Atributos"],
    enabled: true,
    route: "/tools/db-table-viewer",
  },
];
