/**
 * stringInternPool.ts
 * High-performance string interning pool for memory optimization.
 * Reuses identical string references across millions of records,
 * preventing V8 heap exhaustion from redundant string allocations.
 */

export class StringInternPool {
  private readonly pool: Map<string, string> = new Map<string, string>();
  private readonly maxEntries: number;

  constructor(maxEntries: number = 200_000) {
    this.maxEntries = maxEntries;
  }

  /**
   * Returns a canonical interned copy of the given string.
   */
  intern(value: string): string {
    if (value === "") return "";
    const existing = this.pool.get(value);
    if (existing !== undefined) {
      return existing;
    }
    if (this.pool.size < this.maxEntries) {
      this.pool.set(value, value);
    }
    return value;
  }

  /**
   * Clears the interned string cache to allow garbage collection.
   */
  clear(): void {
    this.pool.clear();
  }

  /**
   * Returns current pool size.
   */
  get size(): number {
    return this.pool.size;
  }
}
