export interface SequenceReference {
  schema: string | undefined;
  name: string;
}

const NEXTVAL_PATTERN = /^nextval\(\s*'((?:[^']|'')*)'\s*(?:::\s*regclass\s*)?\)$/i;
const IDENTIFIER = `(?:"(?:[^"]|"")*"|[^".]+)`;
const QUALIFIED_NAME_PATTERN = new RegExp(`^${IDENTIFIER}(?:\\.${IDENTIFIER})?$`);
const IDENTIFIER_PARTS = /"((?:[^"]|"")*)"|([^".]+)/g;

const unquote = (part: RegExpMatchArray): string => (part[1] !== undefined ? part[1].replace(/""/g, '"') : part[2]);

function parseQualifiedName(text: string): SequenceReference | undefined {
  if (!QUALIFIED_NAME_PATTERN.test(text)) return undefined;
  const parts = [...text.matchAll(IDENTIFIER_PARTS)].map(unquote);
  if (parts.length === 1) return { schema: undefined, name: parts[0] };
  return { schema: parts[0], name: parts[1] };
}

/* Reads the text of pg_get_serial_sequence: `schema.name`, with identifiers quoted only where needed. */
export function parseSequenceName(text: string | null | undefined): SequenceReference | undefined {
  if (!text) return undefined;
  return parseQualifiedName(text.trim());
}

export function sequenceReferenceOf(columnDefault: string | null | undefined): SequenceReference | undefined {
  if (!columnDefault) return undefined;
  const match = NEXTVAL_PATTERN.exec(columnDefault.trim());
  if (!match) return undefined;
  return parseSequenceName(match[1].replace(/''/g, "'"));
}
