import React from "react";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { WikiBreadcrumbs, type WikiBreadcrumbItem } from "./WikiBreadcrumbs";
import { WikiEmptyState } from "./WikiEmptyState";
import { WikiSidebar, type WikiSidebarItem } from "./WikiSidebar";
import styles from "./WikiPageView.module.css";

export interface WikiPageViewProps {
  toolSlug: string;
  toolTitle: string;
  pages: ReadonlyArray<WikiSidebarItem>;
  /** The page to show; null when the tool has no pages yet. */
  currentPage: { slug: string; title: string; body: string } | null;
}

/** A tool's wiki page with breadcrumbs and sidebar, or the empty state when it has no pages. */
export const WikiPageView: React.FC<WikiPageViewProps> = ({ toolSlug, toolTitle, pages, currentPage }) => {
  const trail: WikiBreadcrumbItem[] = [{ label: "Wiki", href: "/wiki" }];
  if (currentPage) {
    const isToolLanding = currentPage.title === toolTitle;
    trail.push(
      isToolLanding ? { label: toolTitle } : { label: toolTitle, href: `/wiki/${toolSlug}` },
      ...(isToolLanding ? [] : [{ label: currentPage.title }])
    );
  } else {
    trail.push({ label: toolTitle });
  }

  return (
    <>
      <WikiBreadcrumbs items={trail} />
      {currentPage ? (
        <div className={styles.layout}>
          <WikiSidebar
            toolSlug={toolSlug}
            toolTitle={toolTitle}
            pages={pages}
            currentPageSlug={currentPage.slug}
          />
          <article className={`glass-panel ${styles.article}`}>
            <MarkdownRenderer body={currentPage.body} toolSlug={toolSlug} />
          </article>
        </div>
      ) : (
        <WikiEmptyState toolTitle={toolTitle} />
      )}
    </>
  );
};
