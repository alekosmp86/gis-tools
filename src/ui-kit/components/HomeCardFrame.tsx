import React from "react";
import Link from "next/link";
import { CircleHelp } from "lucide-react";
import styles from "./HomeCardFrame.module.css";

const WIKI_ROUTE_PREFIX = "/wiki";
const HELP_TITLE = "Ayuda";
const HELP_ICON_SIZE = 16;

export interface HomeCardFrameProps {
  wikiSlug: string;
  wikiLabel: string;
  children: React.ReactNode;
}

/**
 * Grid item wrapper for a home card. Renders the card and, as its sibling (never nested inside
 * the card's own link), the "?" link to the tool's wiki. The only place that positions the "?".
 */
export const HomeCardFrame: React.FC<HomeCardFrameProps> = ({ wikiSlug, wikiLabel, children }) => (
  <div className={styles.frame}>
    {children}
    <Link
      href={`${WIKI_ROUTE_PREFIX}/${wikiSlug}`}
      className={styles.helpLink}
      aria-label={`${HELP_TITLE}: ${wikiLabel}`}
      title={HELP_TITLE}
    >
      <CircleHelp size={HELP_ICON_SIZE} />
    </Link>
  </div>
);
