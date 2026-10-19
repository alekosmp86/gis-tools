const BACK_TO_TOP_THRESHOLD_PX = 400;

const SCROLL_BEHAVIOR = {
  AUTO: "auto",
  SMOOTH: "smooth",
} as const;

export type BackToTopScrollBehavior = (typeof SCROLL_BEHAVIOR)[keyof typeof SCROLL_BEHAVIOR];

/** True once the vertical scroll position is strictly past the threshold. */
export function isScrolledPastThreshold(
  scrollY: number,
  thresholdPx: number = BACK_TO_TOP_THRESHOLD_PX,
): boolean {
  return scrollY > thresholdPx;
}

/** Instant scroll for users who prefer reduced motion, smooth otherwise. */
export function resolveScrollBehavior(prefersReducedMotion: boolean): BackToTopScrollBehavior {
  return prefersReducedMotion ? SCROLL_BEHAVIOR.AUTO : SCROLL_BEHAVIOR.SMOOTH;
}
