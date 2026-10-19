"use client";

import React, { useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";
import { isScrolledPastThreshold, resolveScrollBehavior } from "./backToTopLogic";
import styles from "./BackToTopButton.module.css";

const LABEL = "Volver arriba";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const SCROLL_EVENT = "scroll";

/** Floating button that appears once the page is scrolled down and scrolls back to the top. */
export const BackToTopButton: React.FC = () => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const update = () => setVisible(isScrolledPastThreshold(window.scrollY));
    update();
    window.addEventListener(SCROLL_EVENT, update, { passive: true });
    return () => window.removeEventListener(SCROLL_EVENT, update);
  }, []);

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    const prefersReducedMotion = window.matchMedia(REDUCED_MOTION_QUERY).matches;
    window.scrollTo({ top: 0, behavior: resolveScrollBehavior(prefersReducedMotion) });
    event.currentTarget.blur();
  };

  return (
    <button
      type="button"
      className={visible ? `${styles.button} ${styles.visible}` : styles.button}
      aria-label={LABEL}
      title={LABEL}
      aria-hidden={!visible}
      tabIndex={visible ? 0 : -1}
      onClick={handleClick}
    >
      <ArrowUp size={20} />
    </button>
  );
};
