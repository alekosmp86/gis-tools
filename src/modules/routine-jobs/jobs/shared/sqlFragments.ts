import { quoteIdentifier } from "@/core/services/sqlStatements";

export const q = (identifier: string): string => quoteIdentifier(identifier);

export const literal = (value: string): string => `'${value.replace(/'/g, "''")}'`;

export const cte = (name: string, body: string): string => `${q(name)} AS (${body})`;

export const withClause = (ctes: readonly string[]): string => `WITH ${ctes.join(",\n")}`;

export const jsonArrayOf = (select: string, alias: string): string =>
  `COALESCE((SELECT json_agg(${q(alias)}) FROM (${select}) AS ${q(alias)}), '[]'::json)`;
