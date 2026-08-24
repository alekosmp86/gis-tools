import React from "react";
import { featureHighlightsData } from "@/data/featureHighlightsData";
import styles from "./FeatureHighlights.module.css";

export const FeatureHighlights: React.FC = () => {
  return (
    <section className={styles.featuresGrid}>
      {featureHighlightsData.map((feat) => {
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
