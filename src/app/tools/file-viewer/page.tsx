"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { FileViewerContainer } from "@/components/tools/file-viewer/FileViewerContainer";
import styles from "./page.module.css";

export default function FileViewerToolPage() {
  return (
    <div className={styles.container}>
      <Header />

      <main className={styles.main}>
        {/* Back to Portal Link */}
        <div className={styles.backArea}>
          <Link href="/" className={styles.backBtn}>
            <ArrowLeft size={16} />
            <span>Volver al Portal de Herramientas SIG</span>
          </Link>
        </div>

        <div className={styles.workspaceHeader}>
          <h1 className={styles.title}>Visor de Archivos Espaciales</h1>
          <p className={styles.description}>
            Cargue y visualice interactivamente datos geográficos y tablas de atributos desde archivos
            Shapefile (.zip), GeoJSON (.geojson) o CSV (.csv).
          </p>
        </div>

        <FileViewerContainer />
      </main>

      <Footer />
    </div>
  );
}
