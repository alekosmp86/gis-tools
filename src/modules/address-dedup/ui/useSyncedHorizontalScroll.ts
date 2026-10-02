"use client";

import { useEffect, useRef, useState } from "react";

const SCROLL_EPSILON_PX = 1;

function mirrorScroll(source: HTMLElement, target: HTMLElement): void {
  if (Math.abs(target.scrollLeft - source.scrollLeft) >= SCROLL_EPSILON_PX) {
    target.scrollLeft = source.scrollLeft;
  }
}

/**
 * Keeps a thin top scroller and the real content scroller in step. Writing an unchanged
 * `scrollLeft` fires no scroll event, so the two listeners settle instead of looping.
 */
export function useSyncedHorizontalScroll() {
  const topRef = useRef<HTMLDivElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [hasOverflow, setHasOverflow] = useState(false);

  useEffect(() => {
    const top = topRef.current;
    const spacer = spacerRef.current;
    const content = contentRef.current;
    if (!top || !spacer || !content) return;

    const handleTopScroll = () => mirrorScroll(top, content);
    const handleContentScroll = () => mirrorScroll(content, top);
    const measure = () => {
      spacer.style.width = `${content.scrollWidth}px`;
      setHasOverflow(content.scrollWidth > content.clientWidth);
    };

    top.addEventListener("scroll", handleTopScroll, { passive: true });
    content.addEventListener("scroll", handleContentScroll, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    if (content.firstElementChild) observer.observe(content.firstElementChild);
    measure();

    return () => {
      top.removeEventListener("scroll", handleTopScroll);
      content.removeEventListener("scroll", handleContentScroll);
      observer.disconnect();
    };
  }, []);

  return { topRef, spacerRef, contentRef, hasOverflow };
}
