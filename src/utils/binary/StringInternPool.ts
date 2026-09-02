/**
 * StringInternPool.ts
 * Memory-efficient string deduplication pool for processing 1,000,000+ Shapefile DBF records.
 * Categorical values (e.g. department names, land use codes) repeat across millions of rows.
 * By keeping a canonical Map of unique strings, V8 heap usage drops drastically.
 */

export class StringInternPool {
  private readonly pool: Map<string, string>;
  private readonly maxCapacity: number;

  constructor(maxCapacity: number = 100_000) {
    this.pool = new Map<string, string>();
    this.maxCapacity = maxCapacity;
  }

  /**
   * Returns a canonical, deduplicated reference to the given string.
   */
  public intern(value: string): string {
    const existing = this.pool.get(value);
    if (existing !== undefined) {
      return existing;
    }

    if (this.pool.size < this.maxCapacity) {
      this.pool.set(value, value);
    }
    return value;
  }

  /**
   * Returns the current number of unique strings interned in the pool.
   */
  public get size(): number {
    return this.pool.size;
  }

  /**
   * Clears the string interning pool to free memory.
   */
  public clear(): void {
    this.pool.clear();
  }
}
