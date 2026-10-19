import React from "react";
import Link from "next/link";
import styles from "./WikiSidebar.module.css";

export interface WikiSidebarItem {
  slug: string;
  title: string;
}

export interface WikiSidebarProps {
  toolSlug: string;
  toolTitle: string;
  pages: ReadonlyArray<WikiSidebarItem>;
  currentPageSlug: string | null;
}

/** Pages of one tool, in the order given, with the current one highlighted. */
export const WikiSidebar: React.FC<WikiSidebarProps> = ({ toolSlug, toolTitle, pages, currentPageSlug }) => (
  <nav aria-label={`Páginas de ${toolTitle}`} className={`glass-panel ${styles.sidebar}`}>
    <div className={styles.heading}>{toolTitle}</div>
    <ul className={styles.list}>
      {pages.map((page) => (
        <li key={page.slug}>
          <Link
            href={`/wiki/${toolSlug}/${page.slug}`}
            aria-current={page.slug === currentPageSlug ? "page" : undefined}
            className={page.slug === currentPageSlug ? `${styles.item} ${styles.active}` : styles.item}
          >
            {page.title}
          </Link>
        </li>
      ))}
    </ul>
  </nav>
);
