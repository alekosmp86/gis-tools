"use client";

import React, { useId, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { AlertType } from "@/ui-kit/types/ui";
import { warningsHeadline } from "../domain/planView";
import { AvanceMessageList } from "./AvanceMessageList";
import styles from "./AvanceCollapsibleWarnings.module.css";

interface AvanceCollapsibleWarningsProps {
  messages: ReadonlyArray<string>;
}

const SIGNATURE_SEPARATOR = "\u0000";

/** Warnings behind one disclosure, collapsed by default; collapses again when the messages change. */
export const AvanceCollapsibleWarnings: React.FC<AvanceCollapsibleWarningsProps> = ({ messages }) => {
  const bodyId = useId();
  const uniqueMessages = Array.from(new Set(messages));
  const signature = uniqueMessages.join(SIGNATURE_SEPARATOR);
  const [expanded, setExpanded] = useState(false);
  const [seenSignature, setSeenSignature] = useState(signature);

  if (seenSignature !== signature) {
    setSeenSignature(signature);
    setExpanded(false);
  }

  if (uniqueMessages.length === 0) return null;

  const Chevron = expanded ? ChevronDown : ChevronRight;

  return (
    <div className={styles.root}>
      <button
        type="button"
        className={styles.header}
        aria-expanded={expanded}
        aria-controls={bodyId}
        onClick={() => setExpanded((current) => !current)}
      >
        <Chevron size={16} aria-hidden="true" />
        <span className={styles.title}>{warningsHeadline(uniqueMessages.length)}</span>
        <span className={styles.count}>{uniqueMessages.length}</span>
      </button>
      <div id={bodyId} hidden={!expanded}>
        {expanded && <AvanceMessageList messages={uniqueMessages} type={AlertType.WARNING} />}
      </div>
    </div>
  );
};
