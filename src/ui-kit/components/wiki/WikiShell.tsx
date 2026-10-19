import React from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Header } from "@/ui-kit/components/layout/Header";
import { Footer } from "@/ui-kit/components/layout/Footer";
import { BackToTopButton } from "@/ui-kit/components/BackToTopButton";
import styles from "./WikiShell.module.css";

export interface WikiShellProps {
  children: React.ReactNode;
}

/** Page frame for every `/wiki` route: header, back link, content, footer. */
export const WikiShell: React.FC<WikiShellProps> = ({ children }) => (
  <div className={styles.container}>
    <Header />

    <main className={styles.main}>
      <Link href="/" className={styles.backBtn}>
        <ArrowLeft size={16} />
        <span>Volver al Portal de Herramientas SIG</span>
      </Link>

      {children}
    </main>

    <Footer />
    <BackToTopButton />
  </div>
);
