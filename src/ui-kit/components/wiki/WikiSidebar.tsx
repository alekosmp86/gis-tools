import React from "react";
import Link from "next/link";
import styles from "./WikiSidebar.module.css";

export interface WikiSidebarItem {
  slug: string;
  title: string;
  /** Section heading shown before the first page of each run of pages with the same group. */
  group?: string | null;
  /** Slug of the parent page: the item is shown indented as a sub-page. */
  parent?: string | null;
}

export interface WikiSidebarProps {
  toolSlug: string;
  toolTitle: string;
  pages: ReadonlyArray<WikiSidebarItem>;
  currentPageSlug: string | null;
}

const groupStartsAt = (pages: ReadonlyArray<WikiSidebarItem>, index: number): boolean => {
  const group = pages[index]?.group ?? null;
  return group !== null && group !== (pages[index - 1]?.group ?? null);
};

const itemClassOf = (page: WikiSidebarItem, isCurrent: boolean): string =>
  [styles.item, page.parent ? styles.child : "", isCurrent ? styles.active : ""].filter(Boolean).join(" ");

/** Pages of one tool, in the order given, grouped under section headings, with sub-pages indented and the current one highlighted. */
export const WikiSidebar: React.FC<WikiSidebarProps> = ({ toolSlug, toolTitle, pages, currentPageSlug }) => (
  <nav aria-label={`Páginas de ${toolTitle}`} className={`glass-panel ${styles.sidebar}`}>
    <div className={styles.heading}>{toolTitle}</div>
    <ul className={styles.list}>
      {pages.map((page, index) => (
        <React.Fragment key={page.slug}>
          {groupStartsAt(pages, index) && (
            <li role="presentation" className={styles.group}>
              {page.group}
            </li>
          )}
          <li>
            <Link
              href={`/wiki/${toolSlug}/${page.slug}`}
              aria-current={page.slug === currentPageSlug ? "page" : undefined}
              className={itemClassOf(page, page.slug === currentPageSlug)}
            >
              {page.title}
            </Link>
          </li>
        </React.Fragment>
      ))}
    </ul>
  </nav>
);
