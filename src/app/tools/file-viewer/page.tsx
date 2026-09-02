"use client";

import { ToolWorkspaceLayout } from "@/components/layout/ToolWorkspaceLayout";
import { FileViewerContainer } from "@/components/tools/file-viewer/FileViewerContainer";

export default function FileViewerToolPage() {
  return (
    <ToolWorkspaceLayout
      title="Visor de Archivos Espaciales"
      description="Cargue y visualice interactivamente datos geográficos y tablas de atributos desde archivos Shapefile (.zip), GeoJSON (.geojson) o CSV (.csv)."
    >
      <FileViewerContainer />
    </ToolWorkspaceLayout>
  );
}
