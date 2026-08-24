"use client";

import { useState } from "react";
import styles from "./page.module.css";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { HeroSection } from "@/components/home/HeroSection";
import { FilterTabs } from "@/components/home/FilterTabs";
import { SearchInput } from "@/components/ui/SearchInput";
import { ToolCard, type ToolCardData } from "@/components/home/ToolCard";
import { FeatureHighlights } from "@/components/home/FeatureHighlights";
import { GitCompare, FileCode, Database, Cpu, Plus } from "lucide-react";

export default function Home() {
  const [activeCategory, setActiveCategory] = useState<string>("Todos");
  const [searchQuery, setSearchQuery] = useState<string>("");

  const toolsList: ToolCardData[] = [
    {
      id: "gis-sync",
      title: "Sincronización de Datos DB vs. Shapefile",
      category: "Sincronización y Comparación",
      badge: { label: "Herramienta Principal", type: "dev" },
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
      category: "Conversores",
      badge: { label: "Planificado", type: "planned" },
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
      category: "Base de Datos",
      badge: { label: "Planificado", type: "planned" },
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
      category: "Sincronización y Comparación",
      badge: { label: "Planificado", type: "planned" },
      icon: Cpu,
      description:
        "Realice uniones espaciales entre capas de punto en polígono y mapee esquemas de campos no coincidentes automáticamente por centroides.",
      tags: ["Unión Espacial", "Centroide", "Turf.js"],
      actionLabel: "Próximamente",
      enabled: false,
    },
  ];

  const categories = [
    "Todos",
    "Sincronización y Comparación",
    "Conversores",
    "Base de Datos",
  ];

  const filteredTools = toolsList.filter((tool) => {
    const matchesCategory =
      activeCategory === "Todos" || tool.category === activeCategory;
    const matchesSearch =
      tool.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tool.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tool.tags.some((tag) =>
        tag.toLowerCase().includes(searchQuery.toLowerCase())
      );
    return matchesCategory && matchesSearch;
  });

  const handleLaunch = (toolId: string) => {
    alert(`Iniciando herramienta: ${toolId}`);
  };

  return (
    <div className={styles.container}>
      <Header />

      <main className={styles.main}>
        <HeroSection />

        {/* Search & Category Filter Bar */}
        <div className={`glass-panel ${styles.controlsBar}`}>
          <FilterTabs
            categories={categories}
            activeCategory={activeCategory}
            onSelectCategory={setActiveCategory}
          />
          <SearchInput
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Buscar herramientas o etiquetas..."
          />
        </div>

        {/* Tools Cards Grid */}
        <section className={styles.grid}>
          {filteredTools.map((tool) => (
            <ToolCard key={tool.id} tool={tool} onLaunch={handleLaunch} />
          ))}

          {/* Add New Tool Request Card */}
          <div className={`glass-panel ${styles.addCard}`}>
            <div className={styles.addIcon}>
              <Plus size={24} />
            </div>
            <div>
              <h4 style={{ fontSize: "1.1rem", fontWeight: 600 }}>
                Solicitar Nueva Herramienta SIG
              </h4>
              <p style={{ fontSize: "0.85rem", color: "var(--text-dim)", marginTop: "4px" }}>
                Agregue conversores espaciales personalizados, validadores o calculadoras.
              </p>
            </div>
          </div>
        </section>

        <FeatureHighlights />
      </main>

      <Footer />
    </div>
  );
}
