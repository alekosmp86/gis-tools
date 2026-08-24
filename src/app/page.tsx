"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./page.module.css";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { HeroSection } from "@/components/home/HeroSection";
import { FilterTabs } from "@/components/home/FilterTabs";
import { SearchInput } from "@/components/ui/SearchInput";
import { ToolCard } from "@/components/home/ToolCard";
import { FeatureHighlights } from "@/components/home/FeatureHighlights";
import { toolsList, toolCategories } from "@/data/toolsData";
import { ToolCategory } from "@/types/gis";
import { Plus } from "lucide-react";

export default function Home() {
  const router = useRouter();
  const [activeCategory, setActiveCategory] = useState<string>(ToolCategory.ALL);
  const [searchQuery, setSearchQuery] = useState<string>("");

  const filteredTools = toolsList.filter((tool) => {
    const matchesCategory =
      activeCategory === ToolCategory.ALL || tool.category === activeCategory;
    const matchesSearch =
      tool.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tool.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tool.tags.some((tag) =>
        tag.toLowerCase().includes(searchQuery.toLowerCase())
      );
    return matchesCategory && matchesSearch;
  });

  const handleLaunch = (toolId: string) => {
    const targetTool = toolsList.find((t) => t.id === toolId);
    if (targetTool?.route) {
      router.push(targetTool.route);
    }
  };

  return (
    <div className={styles.container}>
      <Header />

      <main className={styles.main}>
        <HeroSection />

        {/* Search & Category Filter Bar */}
        <div className={`glass-panel ${styles.controlsBar}`}>
          <FilterTabs
            categories={toolCategories}
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
              <h4 className={styles.addTitle}>
                Solicitar Nueva Herramienta SIG
              </h4>
              <p className={styles.addText}>
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
