export interface UniqueKeysQueryClient {
  query(sql: string, values: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

interface CatalogKey {
  readonly isPrimary: boolean;
  readonly columns: string[];
}

const MAX_UNIQUE_KEYS = 10;

const UNIQUE_KEYS_SQL = `
  SELECT i.indisprimary AS is_primary, array_agg(a.attname::text ORDER BY k.ordinal) AS columns
  FROM pg_index i
  JOIN pg_class t ON t.oid = i.indrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  CROSS JOIN LATERAL unnest(i.indkey::int2[]) WITH ORDINALITY AS k(attnum, ordinal)
  JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
  WHERE n.nspname = $1 AND t.relname = $2
    AND k.ordinal <= COALESCE((to_jsonb(i)->>'indnkeyatts')::int, i.indnatts)
    AND i.indisvalid AND i.indisunique AND i.indpred IS NULL AND i.indexprs IS NULL
  GROUP BY i.indexrelid, i.indisprimary
  ORDER BY i.indisprimary DESC, i.indexrelid`;

const toCatalogKey = (row: Record<string, unknown>): CatalogKey => ({
  isPrimary: row.is_primary === true,
  columns: Array.isArray(row.columns) ? row.columns.map((column) => String(column)) : [],
});

const sameColumns = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((column, index) => column === right[index]);

const primaryFirst = (keys: CatalogKey[]): CatalogKey[] =>
  [...keys].sort((left, right) => Number(right.isPrimary) - Number(left.isPrimary));

function distinctKeys(keys: CatalogKey[]): string[][] {
  const kept: string[][] = [];
  for (const key of keys) {
    if (key.columns.length === 0) continue;
    if (kept.some((existing) => sameColumns(existing, key.columns))) continue;
    kept.push(key.columns);
  }
  return kept.slice(0, MAX_UNIQUE_KEYS);
}

export async function readUniqueKeys(client: UniqueKeysQueryClient, schema: string, table: string): Promise<string[][]> {
  const result = await client.query(UNIQUE_KEYS_SQL, [schema, table]);
  return distinctKeys(primaryFirst(result.rows.map(toCatalogKey)));
}
