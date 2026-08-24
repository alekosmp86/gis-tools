import React from "react";
import styles from "./Footer.module.css";

export const Footer: React.FC = () => {
  return (
    <footer className={styles.footer}>
      <div className={styles.footerContent}>
        <span>Espacio de Trabajo SIG &bull; Entorno Node.js v24.19.0 Portable</span>
      </div>
    </footer>
  );
};
