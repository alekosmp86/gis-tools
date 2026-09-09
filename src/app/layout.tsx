import type { Metadata } from "next";
import { QueryProvider } from "@/providers/QueryProvider";
import { ModuleContributionsProvider } from "@/ui-kit/modules/ModuleContributionsContext";
import { moduleRegistry } from "./modules.registry";
import "./globals.css";

export const metadata: Metadata = {
  title: "Suite de Herramientas SIG | Procesamiento Espacial",
  description: "Herramientas espaciales de alto rendimiento para comparar tablas de bases de datos con archivos Shapefile/GeoJSON y generar parches SQL para PostGIS.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body>
        <QueryProvider>
          <ModuleContributionsProvider contributions={moduleRegistry.uiContributions()}>
            {children}
          </ModuleContributionsProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
