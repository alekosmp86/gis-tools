import React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import styles from "./WikiBreadcrumbs.module.css";

export interface WikiBreadcrumbItem {
  label: string;
  /** Omitted for the current location. */
  href?: string;
}

export interface WikiBreadcrumbsProps {
  items: ReadonlyArray<WikiBreadcrumbItem>;
}

/** Trail such as Wiki > Tool > Page. */
export const WikiBreadcrumbs: React.FC<WikiBreadcrumbsProps> = ({ items }) => (
  <nav aria-label="Ruta de navegación" className={styles.breadcrumbs}>
    {items.map((item, index) => (
      <React.Fragment key={item.href ?? "current"}>
        {index > 0 && <ChevronRight size={14} className={styles.separator} />}
        {item.href ? (
          <Link href={item.href} className={styles.link}>
            {item.label}
          </Link>
        ) : (
          <span aria-current="page" className={styles.current}>
            {item.label}
          </span>
        )}
      </React.Fragment>
    ))}
  </nav>
);
