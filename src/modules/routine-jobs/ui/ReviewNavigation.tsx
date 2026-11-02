"use client";

import React, { useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/ui-kit/components/ui/Button";
import { ButtonVariant } from "@/ui-kit/types/ui";
import styles from "./PadronReview.module.css";

const ICON_SIZE = 15;
const PREVIOUS_LABEL = "Anterior";
const NEXT_LABEL = "Siguiente";
const PREVIOUS_BUTTON = 0;
const NEXT_BUTTON = 1;

export interface ReviewNavigationProps {
  index: number;
  total: number;
  onNavigate: (index: number) => void;
}

/** Moves through the rows of the table the modal was opened from, in table order, without closing it. */
export function ReviewNavigation({ index, total, onNavigate }: ReviewNavigationProps) {
  const navRef = useRef<HTMLElement>(null);
  const lastIndex = total - 1;

  /* A button that turns disabled under focus drops it to the page: the focus moves to the other button first. */
  const navigateTo = (target: number, atEdge: boolean, otherButton: number) => {
    onNavigate(target);
    if (atEdge) navRef.current?.querySelectorAll("button")[otherButton]?.focus();
  };

  return (
    <nav ref={navRef} className={styles.navigation} aria-label="Recorrer la tabla">
      <Button
        variant={ButtonVariant.SECONDARY}
        onClick={() => navigateTo(index - 1, index - 1 <= 0, NEXT_BUTTON)}
        disabled={index <= 0}
      >
        <ChevronLeft size={ICON_SIZE} />
        <span>{PREVIOUS_LABEL}</span>
      </Button>
      <span className={styles.position} aria-live="polite">{`${index + 1} de ${total}`}</span>
      <Button
        variant={ButtonVariant.SECONDARY}
        onClick={() => navigateTo(index + 1, index + 1 >= lastIndex, PREVIOUS_BUTTON)}
        disabled={index >= lastIndex}
      >
        <span>{NEXT_LABEL}</span>
        <ChevronRight size={ICON_SIZE} />
      </Button>
    </nav>
  );
}
