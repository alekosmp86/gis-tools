import React from "react";
import { Zap, ShieldCheck, Globe } from "lucide-react";
import styles from "./FeatureHighlights.module.css";

export const FeatureHighlights: React.FC = () => {
  const features = [
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

  return (
    <section className={styles.featuresGrid}>
      {features.map((feat) => {
        const Icon = feat.icon;
        return (
          <div key={feat.title} className={`glass-panel ${styles.featureCard}`}>
            <div className={styles.featureIcon}>
              <Icon size={22} />
            </div>
            <div>
              <h4 className={styles.featureTitle}>{feat.title}</h4>
              <p className={styles.featureDesc}>{feat.description}</p>
            </div>
          </div>
        );
      })}
    </section>
  );
};
