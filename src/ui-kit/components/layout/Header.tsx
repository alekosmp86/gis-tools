import React from "react";
import { Layers, Terminal } from "lucide-react";
import styles from "./Header.module.css";

export const Header: React.FC = () => {
  return (
    <header className={styles.header}>
      <div className={styles.headerContent}>
        <div className={styles.logoArea}>
          <div className={styles.logoIcon}>
            <Layers size={22} />
          </div>
          <div>
            <div className={styles.brandName}>Suite de Herramientas SIG</div>
            <div className={styles.brandSub}>Espacio de Trabajo Espacial</div>
          </div>
        </div>

        <div className={styles.headerActions}>
          <div className={styles.envTag}>
            <Terminal size={14} />
            <span>Node 24 Portable</span>
          </div>
          <div className={styles.envTag}>
            <div className={styles.statusDot} />
            <span>Motor Listo</span>
          </div>
        </div>
      </div>
    </header>
  );
};
