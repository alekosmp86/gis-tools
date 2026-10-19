import React, { Children, cloneElement, isValidElement } from "react";
import { parseWikiCalloutMarker } from "@/core/wiki/callouts";
import { WikiCallout } from "./WikiCallout";
import styles from "./WikiBlockquote.module.css";

interface ParagraphProps {
  children?: React.ReactNode;
}

function isMeaningfulNode(node: React.ReactNode): boolean {
  return typeof node !== "string" || node.trim().length > 0;
}

export interface WikiBlockquoteProps {
  children?: React.ReactNode;
}

/** Blockquote that becomes a callout when it opens with a GitHub alert marker; plain otherwise. */
export const WikiBlockquote: React.FC<WikiBlockquoteProps> = ({ children }) => {
  const blocks = Children.toArray(children).filter(isMeaningfulNode);
  const [firstBlock, ...otherBlocks] = blocks;

  if (isValidElement<ParagraphProps>(firstBlock)) {
    const [firstInline, ...otherInlines] = Children.toArray(firstBlock.props.children);
    const marker = typeof firstInline === "string" ? parseWikiCalloutMarker(firstInline) : null;

    if (marker) {
      const leadingInlines = [marker.remainder, ...otherInlines].filter(isMeaningfulNode);
      const leadingBlock = leadingInlines.length > 0 ? cloneElement(firstBlock, undefined, ...leadingInlines) : null;

      return (
        <WikiCallout kind={marker.kind}>
          {leadingBlock}
          {otherBlocks}
        </WikiCallout>
      );
    }
  }

  return <blockquote className={styles.blockquote}>{children}</blockquote>;
};
