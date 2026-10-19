/**
 * Folds text to a comparison key: lower-cased, diacritics stripped, surrounding whitespace removed.
 */
function toSearchKey(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim();
}

function nameMatches(name: string, queryKey: string): boolean {
  return toSearchKey(name).includes(queryKey);
}

/**
 * Returns the items whose `name` contains the query, preserving input order.
 * Matching ignores case, diacritics and surrounding whitespace; an empty or blank query matches all.
 */
export function filterByName<TItem extends { name: string }>(
  items: ReadonlyArray<TItem>,
  query: string,
): TItem[] {
  const queryKey = toSearchKey(query);
  if (queryKey.length === 0) {
    return [...items];
  }
  return items.filter((item) => nameMatches(item.name, queryKey));
}
