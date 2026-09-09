import React from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Header } from "./Header";
import { Footer } from "./Footer";
import styles from "./ToolWorkspaceLayout.module.css";

export interface ToolWorkspaceLayoutProps {
  title: string;
  description: string;
  children: React.ReactNode;
}

export const ToolWorkspaceLayout: React.FC<ToolWorkspaceLayoutProps> = ({
  title,
  description,
  children,
}) => {
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
          <h1 className={styles.title}>{title}</h1>
          <p className={styles.description}>{description}</p>
        </div>

        {children}
      </main>

      <Footer />
    </div>
  );
};
