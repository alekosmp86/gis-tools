"use client";

import { FolderTree } from "lucide-react";
import { extensionRegistry } from "@/services/extensions/extensionRegistry";
import { moduleRegistry } from "@/services/extensions/moduleRegistry";
import {
  SupportedExtensionFormat,
  type FileSourceTabExtension,
} from "@/types/extensions";
import { CatalogTreeSelector } from "./components/CatalogTreeSelector";
import { WatcherDashboard } from "./components/WatcherDashboard";
import { fetchCatalogFileAsBrowserFile } from "./services/watcherApi";

export const cartographyWatcherExtension: FileSourceTabExtension = {
  id: "cartography-catalog",
  label: "Catálogo Cartográfico",
  icon: FolderTree,
  supportedFormats: [SupportedExtensionFormat.CSV, SupportedExtensionFormat.SHP],
  supportedTools: ["db-csv-sync", "db-shapefile-sync"],
  renderSelector: ({ format, onSelectFile, isLoading }) => (
    <CatalogTreeSelector
      acceptedFormat={format}
      onSelectFile={onSelectFile}
      isLoadingFile={isLoading}
    />
  ),
  autoLoad: async ({ sourceSlug, resourceId }) => {
    if (!sourceSlug || !resourceId) {
      throw new Error("Faltan parámetros requeridos de la capa cartográfica.");
    }
    const result = await fetchCatalogFileAsBrowserFile(sourceSlug, resourceId);
    if (!result.ok) {
      throw new Error(result.error);
    }
    return result.data;
  },
};

export function registerCartographyWatcherExtension(): () => void {
  const unregisterTab = extensionRegistry.registerFileSourceTab(cartographyWatcherExtension);
  const unregisterTool = moduleRegistry.registerTool({
    id: "cartography-watcher",
    title: "Observador de Actualizaciones Cartográficas",
    description:
      "Monitoree catálogos abiertos de datos espaciales (CKAN IDEuy), detecte automáticamente la publicación de nuevas versiones de ejes viales y descargue los datasets al vault local.",
    component: WatcherDashboard,
  });

  return () => {
    unregisterTab();
    unregisterTool();
  };
}
