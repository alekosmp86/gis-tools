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

export const buildTruncateStatement = (schema: string | undefined | null, table: string): string =>
  `TRUNCATE TABLE ${quoteIdentifier(resolveSchemaName(schema))}.${quoteIdentifier(table)};`;
