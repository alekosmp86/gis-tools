import React from "react";
import Link from "next/link";
import { BookOpen } from "lucide-react";
import styles from "./WikiToolCard.module.css";

export interface WikiToolCardProps {
  toolSlug: string;
  title: string;
  pageCount: number;
}

function describePageCount(pageCount: number): string {
  if (pageCount === 0) return "En construcción";
  return pageCount === 1 ? "1 página" : `${pageCount} páginas`;
}

/** Link card to a tool's wiki on the `/wiki` index. */
export const WikiToolCard: React.FC<WikiToolCardProps> = ({ toolSlug, title, pageCount }) => (
  <Link href={`/wiki/${toolSlug}`} className={`glass-panel ${styles.card}`}>
    <BookOpen size={20} className={styles.icon} />
    <div className={styles.title}>{title}</div>
    <div className={styles.meta}>{describePageCount(pageCount)}</div>
  </Link>
);
