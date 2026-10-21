export function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

export function quoteQualified(name: string): string {
  return name.split(".").map(quoteIdentifier).join(".");
}
