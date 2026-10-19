import type { Metadata } from "next";
import { getWikiIndex } from "@/app/wiki/wikiSources";
import { WikiShell } from "@/ui-kit/components/wiki/WikiShell";
import { WikiToolCard } from "@/ui-kit/components/wiki/WikiToolCard";
import styles from "./wiki.module.css";

export const metadata: Metadata = { title: "Wiki | Suite de Herramientas SIG" };

export default async function WikiIndexPage() {
  const wikiIndex = await getWikiIndex();

  return (
    <WikiShell>
      <div className={styles.header}>
        <h1 className={styles.title}>Wiki</h1>
        <p className={styles.description}>Guías de uso de cada herramienta.</p>
      </div>
      <section className={styles.grid}>
        {wikiIndex.tools().map((tool) => (
          <WikiToolCard
            key={tool.toolSlug}
            toolSlug={tool.toolSlug}
            title={tool.title}
            pageCount={tool.pages.length}
          />
        ))}
      </section>
    </WikiShell>
  );
}
