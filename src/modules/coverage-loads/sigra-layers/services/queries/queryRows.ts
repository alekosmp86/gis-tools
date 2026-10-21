import type { Queryable } from "../../../shared/pgClient";

export type DatabaseRow = Record<string, unknown>;

export async function firstRow(queryable: Queryable, sql: string, values: unknown[] = []): Promise<DatabaseRow> {
  const result = await queryable.query(sql, values);
  return (result.rows[0] ?? {}) as DatabaseRow;
}
