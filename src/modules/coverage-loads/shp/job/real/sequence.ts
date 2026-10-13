/** Runs `step` for each item strictly one after the other (no loop with `await` inside). */
export function forEachSequential<T>(items: readonly T[], step: (item: T, index: number) => Promise<void>): Promise<void> {
  return items.reduce<Promise<void>>((previous, item, index) => previous.then(() => step(item, index)), Promise.resolve());
}
