import { buildQualifiedTableLabel, resolveSchemaName } from "@/core/services/sqlStatements";
import type { ReplaceInsertColumn } from "@/core/services/replaceColumnMapping";
import type { DbColumnMetadata } from "@/core/types/db";

export interface SequenceRef {
  qualifiedLabel: string;
  schema: string;
  name: string;
}

export interface SequenceDiscovery {
  sequences: SequenceRef[];
  unparsedDefaults: string[];
}

const NEXTVAL_PATTERN = /^\s*nextval\s*\(\s*'((?:[^']|'')*)'\s*(?:::\s*(?:regclass|text))?\s*\)\s*$/i;

function splitIdentifierParts(text: string): string[] | null {
  const parts: string[] = [];
  let index = 0;
  while (index < text.length) {
    if (text[index] === '"') {
      let part = "";
      index++;
      for (;;) {
        if (index >= text.length) return null;
        if (text[index] === '"') {
          if (text[index + 1] === '"') {
            part += '"';
            index += 2;
            continue;
          }
          index++;
          break;
        }
        part += text[index++];
      }
      parts.push(part);
    } else {
      let part = "";
      while (index < text.length && text[index] !== ".") {
        if (text[index] === '"') return null;
        part += text[index++];
      }
      const trimmed = part.trim().toLowerCase();
      if (trimmed === "") return null;
      parts.push(trimmed);
    }
    if (index < text.length) {
      if (text[index] !== ".") return null;
      index++;
      if (index >= text.length) return null;
    }
  }
  return parts.length === 1 || parts.length === 2 ? parts : null;
}

function parseSequenceDefault(columnDefault: string, targetSchema: string): SequenceRef | null {
  const match = NEXTVAL_PATTERN.exec(columnDefault);
  if (!match) return null;
  const parts = splitIdentifierParts(match[1].replace(/''/g, "'"));
  if (!parts) return null;
  const [schema, name] = parts.length === 2 ? parts : [targetSchema, parts[0]];
  return { qualifiedLabel: buildQualifiedTableLabel(schema, name), schema, name };
}

export function discoverTargetSequences(
  targetDetails: DbColumnMetadata[],
  insertColumns: ReplaceInsertColumn[],
  targetSchema: string | undefined | null
): SequenceDiscovery {
  const schema = resolveSchemaName(targetSchema);
  const mappedColumns = new Set(
    insertColumns.flatMap((column) => (column.sourceColumn ? [column.targetColumn] : []))
  );
  const sequences = new Map<string, SequenceRef>();
  const unparsedDefaults: string[] = [];

  targetDetails.forEach((detail) => {
    const columnDefault = detail.column_default;
    if (mappedColumns.has(detail.column_name) || !columnDefault || !/nextval\s*\(/i.test(columnDefault)) return;
    const sequence = parseSequenceDefault(columnDefault, schema);
    if (sequence) sequences.set(`${sequence.schema}\u0000${sequence.name}`, sequence);
    else unparsedDefaults.push(`${detail.column_name}: ${columnDefault}`);
  });

  return { sequences: Array.from(sequences.values()), unparsedDefaults };
}
