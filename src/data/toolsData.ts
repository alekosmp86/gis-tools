import { GitCompare, FileSpreadsheet, Eye, Database } from "lucide-react";
import { ToolCategory, type ToolCardData } from "@/ui-kit/types/ui";
import { BadgeVariant } from "@/ui-kit/types/ui";

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
    id: "spatial-explorer",
    title: "Explorador Espacial WebGL",
    category: [ToolCategory.VIEWERS, ToolCategory.DATABASE],
    badge: { label: "Activa", type: BadgeVariant.ACTIVE },
    icon: Eye,
    description:
      "Visualice interactivamente entidades geográficas, metadatos y tablas de atributos desde archivos locales (Shapefile, GeoJSON, CSV) o tablas PostGIS sobre un motor gráfico WebGL con deck.gl.",
    tags: ["Shapefile", "GeoJSON", "CSV", "PostGIS", "WebGL", "deck.gl"],
    enabled: true,
    route: "/tools/spatial-explorer",
  },
];
