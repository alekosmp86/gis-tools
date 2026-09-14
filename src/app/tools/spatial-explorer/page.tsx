"use client";

import { ToolWorkspaceLayout } from "@/ui-kit/components/layout/ToolWorkspaceLayout";
import { SpatialExplorerContainer } from "@/components/tools/spatial-explorer/SpatialExplorerContainer";

export default function SpatialExplorerPage() {
  return (
    <ToolWorkspaceLayout
      title="Explorador Espacial"
      description="Visualice e interactúe con entidades geográficas, metadatos y tablas de atributos desde archivos espaciales locales o tablas de bases de datos PostgreSQL/PostGIS sobre un motor gráfico WebGL de alto rendimiento."
    >
      <SpatialExplorerContainer />
    </ToolWorkspaceLayout>
  );
}
