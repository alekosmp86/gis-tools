interface KeyedRow<Row> {
  key: string;
  row: Row;
}

/** Pairs each row with a key built from its content; repeated content gets an occurrence suffix. */
export function keyedRowsOf<Row>(rows: Row[], contentOf: (row: Row) => string): KeyedRow<Row>[] {
  const occurrences = new Map<string, number>();
  return rows.map((row) => {
    const content = contentOf(row);
    const occurrence = occurrences.get(content) ?? 0;
    occurrences.set(content, occurrence + 1);
    return { key: `${content}#${occurrence}`, row };
  });
}
