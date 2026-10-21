const DEFAULT_SCHEMA = "public";

export const quoteIdentifier = (identifier: string): string => `"${identifier.replace(/"/g, '""')}"`;

export const resolveSchemaName = (schema: string | undefined | null): string =>
  schema && schema.trim() !== "" ? schema : DEFAULT_SCHEMA;

export const buildQualifiedTableLabel = (schema: string | undefined | null, table: string): string =>
  `${resolveSchemaName(schema)}.${table}`;

const quoteTextLiteral = (text: string): string => {
  const escaped = text.replace(/'/g, "''");
  if (!/[\\\n\r]/.test(text)) return `'${escaped}'`;
  const body = escaped.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/\r/g, "\\r");
  return `E'${body}'`;
};

export const formatReplaceLiteral = (value: unknown): string => {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "string") return quoteTextLiteral(value);
  if (typeof value === "boolean") return String(value);
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  return quoteTextLiteral(JSON.stringify(value));
};

export const buildDeleteStatement = (schema: string | undefined | null, table: string): string =>
  `DELETE FROM ${quoteIdentifier(resolveSchemaName(schema))}.${quoteIdentifier(table)};`;

export const buildResetSequenceStatement = (schema: string, name: string): string =>
  `SELECT setval('${`${quoteIdentifier(schema)}.${quoteIdentifier(name)}`.replace(/'/g, "''")}'::regclass, 1, false);`;

export const buildRepairSequenceStatement = (
  sequenceSchema: string,
  sequenceName: string,
  tableSchema: string | undefined | null,
  tableName: string,
  columns: string[]
): string => {
  const sequenceLiteral = `'${`${quoteIdentifier(sequenceSchema)}.${quoteIdentifier(sequenceName)}`.replace(/'/g, "''")}'::regclass`;
  const table = `${quoteIdentifier(resolveSchemaName(tableSchema))}.${quoteIdentifier(tableName)}`;
  const maxima = columns.map((column) => `(SELECT max(${quoteIdentifier(column)}) FROM ${table})`).join(", ");
  return `SELECT setval(${sequenceLiteral}, GREATEST(COALESCE(GREATEST(${maxima}), 0) + 1, COALESCE(pg_sequence_last_value(${sequenceLiteral}) + 1, 1)), false);`;
};

export const buildAnalyzeStatement = (schema: string | undefined | null, table: string): string =>
  `ANALYZE ${quoteIdentifier(resolveSchemaName(schema))}.${quoteIdentifier(table)};`;
