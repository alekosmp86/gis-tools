import { Zap, ShieldCheck, Globe } from "lucide-react";
import type { FeatureHighlightData } from "@/types/ui";


export const featureHighlightsData: FeatureHighlightData[] = [
  {
    icon: Zap,
    title: "Motor 100% en el Navegador",
    description: "El procesamiento espacial y los cálculos de diferencias se ejecutan totalmente en la memoria local del navegador.",
  },
  {
    icon: ShieldCheck,
    title: "Privacidad de Datos Garantizada",
    description: "Las tablas de bases de datos y los archivos Shapefile nunca salen de su equipo local.",
  },
  {
    icon: Globe,
    title: "Listo para PostGIS y Estándares",
    description: "Soporta GeoJSON estándar, archivos Shapefile (.shp/.dbf) y exportación de scripts SQL.",
  },
];
