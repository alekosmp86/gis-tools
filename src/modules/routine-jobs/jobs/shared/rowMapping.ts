export type Row = Record<string, unknown>;

const finiteOrNull = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/** Missing or non-numeric values count as 0, so a report never carries NaN. */
export const numberOf = (value: unknown): number => finiteOrNull(value ?? 0) ?? 0;

export const nullableNumber = (value: unknown): number | null =>
  value === null || value === undefined ? null : finiteOrNull(value);

export const textOf = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));

export const listOf = (value: unknown): Row[] => (Array.isArray(value) ? (value as Row[]) : []);
