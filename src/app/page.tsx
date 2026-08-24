"use client";

import { useState } from "react";
import styles from "./page.module.css";
import {
  Globe,
  Layers,
  Database,
  GitCompare,
  FileCode,
  Search,
  Plus,
  ArrowRight,
  ShieldCheck,
  Zap,
  Cpu,
  Sparkles,
  Terminal,
  type LucideIcon,
} from "lucide-react";

interface ToolItem {
  id: string;
  title: string;
  category: "Sync & Compare" | "Converters" | "Database";
  badge: { label: string; type: "active" | "dev" | "planned" };
  icon: LucideIcon;
  description: string;
  tags: string[];
  actionLabel: string;
  enabled: boolean;
}

export default function Home() {
  const [activeCategory, setActiveCategory] = useState<string>("All");
  const [searchQuery, setSearchQuery] = useState<string>("");

  const toolsList: ToolItem[] = [
    {
      id: "gis-sync",
      title: "DB vs. Shapefile Dataset Sync",
      category: "Sync & Compare",
      badge: { label: "Target Tool", type: "dev" },
      icon: GitCompare,
      description:
        "Correlate database attribute tables against Shapefile/GeoJSON layers. Highlight discrepancies on an interactive map and generate PostGIS SQL update scripts.",
      tags: ["Shapefile", "PostGIS", "Turf.js", "Leaflet"],
      actionLabel: "Launch Suite",
      enabled: true,
    },
    {
      id: "spatial-converter",
      title: "Spatial Format Converter",
      category: "Converters",
      badge: { label: "Planned", type: "planned" },
      icon: FileCode,
      description:
        "Batch convert spatial formats client-side between Shapefile (.shp), KML, GeoJSON, and WKT without sending data to any external server.",
      tags: ["GeoJSON", "Shapefile", "KML", "WKT"],
      actionLabel: "Coming Soon",
      enabled: false,
    },
    {
      id: "postgis-patcher",
      title: "PostGIS SQL Patch Builder",
      category: "Database",
      badge: { label: "Planned", type: "planned" },
      icon: Database,
      description:
        "Generate optimized ST_GeomFromGeoJSON migration patches and audit tables from spatial geometry change logs.",
      tags: ["PostgreSQL", "PostGIS", "SQL"],
      actionLabel: "Coming Soon",
      enabled: false,
    },
    {
      id: "spatial-joiner",
      title: "Spatial Attribute Joiner",
      category: "Sync & Compare",
      badge: { label: "Planned", type: "planned" },
      icon: Cpu,
      description:
        "Perform spatial joins between point-in-polygon layers and map mismatched field schemas automatically via spatial centroids.",
      tags: ["Spatial Join", "Centroid Match", "Turf.js"],
      actionLabel: "Coming Soon",
      enabled: false,
    },
  ];

  const filteredTools = toolsList.filter((tool) => {
    const matchesCategory =
      activeCategory === "All" || tool.category === activeCategory;
    const matchesSearch =
      tool.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tool.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tool.tags.some((tag) =>
        tag.toLowerCase().includes(searchQuery.toLowerCase())
      );
    return matchesCategory && matchesSearch;
  });

  return (
    <div className={styles.container}>
      {/* Top Header */}
      <header className={styles.header}>
        <div className={styles.headerContent}>
          <div className={styles.logoArea}>
            <div className={styles.logoIcon}>
              <Layers size={22} />
            </div>
            <div>
              <div className={styles.brandName}>GIS Tools Suite</div>
              <div className={styles.brandSub}>Spatial Data Workspace</div>
            </div>
          </div>

          <div className={styles.headerActions}>
            <div className={styles.envTag}>
              <Terminal size={14} />
              <span>Node 24 Portable</span>
            </div>
            <div className={styles.envTag}>
              <div className={styles.statusDot} />
              <span>Engine Ready</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className={styles.main}>
        {/* Hero Section */}
        <section className={styles.hero}>
          <div className={styles.heroTag}>
            <span className="badge badge-active">
              <Sparkles size={12} /> Spatial Engineering Toolkit
            </span>
          </div>

          <h1 className={styles.title}>
            Geographical Information <br />
            <span className="text-gradient-cyan">System Tools Portal</span>
          </h1>

          <p className={styles.description}>
            A high-performance, browser-native suite for correlating spatial datasets,
            detecting attribute & geometry discrepancies between databases and Shapefiles,
            and exporting PostGIS update patches.
          </p>
        </section>

        {/* Controls Bar */}
        <div className={`glass-panel ${styles.controlsBar}`}>
          <div className={styles.filterGroup}>
            {["All", "Sync & Compare", "Converters", "Database"].map((cat) => (
              <button
                key={cat}
                className={`${styles.filterBtn} ${
                  activeCategory === cat ? styles.filterActive : ""
                }`}
                onClick={() => setActiveCategory(cat)}
              >
                {cat}
              </button>
            ))}
          </div>

          <div className={styles.searchBox}>
            <Search size={16} color="var(--text-dim)" />
            <input
              type="text"
              placeholder="Search tools or tags..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Tools Cards Grid */}
        <section className={styles.grid}>
          {filteredTools.map((tool) => {
            const IconComponent = tool.icon;
            return (
              <div key={tool.id} className={`glass-panel ${styles.card}`}>
                <div className={styles.cardHeader}>
                  <div className={styles.cardIcon}>
                    <IconComponent size={24} />
                  </div>
                  <span
                    className={`badge ${
                      tool.badge.type === "active"
                        ? "badge-active"
                        : tool.badge.type === "dev"
                        ? "badge-dev"
                        : "badge-planned"
                    }`}
                  >
                    {tool.badge.label}
                  </span>
                </div>

                <div>
                  <h3 className={styles.cardTitle}>{tool.title}</h3>
                  <p className={styles.cardDesc}>{tool.description}</p>

                  <div className={styles.tagContainer}>
                    {tool.tags.map((tag) => (
                      <span key={tag} className={styles.tag}>
                        #{tag}
                      </span>
                    ))}
                  </div>
                </div>

                <div className={styles.cardFooter}>
                  {tool.enabled ? (
                    <button
                      className={styles.actionBtn}
                      onClick={() => alert(`Starting ${tool.title}...`)}
                    >
                      <span>{tool.actionLabel}</span>
                      <ArrowRight size={16} />
                    </button>
                  ) : (
                    <button
                      className={`${styles.actionBtn} ${styles.actionBtnDisabled}`}
                      disabled
                    >
                      <span>{tool.actionLabel}</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {/* Add New Tool Card */}
          <div className={`glass-panel ${styles.addCard}`}>
            <div className={styles.addIcon}>
              <Plus size={24} />
            </div>
            <div>
              <h4 style={{ fontSize: "1.1rem", fontWeight: 600 }}>
                Request New GIS Tool
              </h4>
              <p style={{ fontSize: "0.85rem", color: "var(--text-dim)", marginTop: "4px" }}>
                Add custom spatial converters, validators or calculators.
              </p>
            </div>
          </div>
        </section>

        {/* System Highlights */}
        <section className={styles.featuresGrid}>
          <div className={`glass-panel ${styles.featureCard}`}>
            <div className={styles.featureIcon}>
              <Zap size={22} />
            </div>
            <div>
              <h4 className={styles.featureTitle}>100% Client-Side Engine</h4>
              <p className={styles.featureDesc}>
                Spatial parsing and diff calculations run entirely in browser memory.
              </p>
            </div>
          </div>

          <div className={`glass-panel ${styles.featureCard}`}>
            <div className={styles.featureIcon}>
              <ShieldCheck size={22} />
            </div>
            <div>
              <h4 className={styles.featureTitle}>Data Privacy Guaranteed</h4>
              <p className={styles.featureDesc}>
                Database tables and Shapefiles never leave your local system.
              </p>
            </div>
          </div>

          <div className={`glass-panel ${styles.featureCard}`}>
            <div className={styles.featureIcon}>
              <Globe size={22} />
            </div>
            <div>
              <h4 className={styles.featureTitle}>PostGIS & Standard Ready</h4>
              <p className={styles.featureDesc}>
                Supports standard GeoJSON, Shapefiles (.shp/.dbf), and SQL output.
              </p>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className={styles.footer}>
        <div className={styles.headerContent} style={{ justifyContent: "center" }}>
          <span>GIS Tools Workspace &bull; Portable Node.js v24.19.0 Environment</span>
        </div>
      </footer>
    </div>
  );
}
