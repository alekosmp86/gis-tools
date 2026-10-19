/** Callout kinds supported through GitHub alert syntax. */
export const WikiCalloutKind = {
  NOTE: "NOTE",
  TIP: "TIP",
  WARNING: "WARNING",
} as const;
export type WikiCalloutKind = (typeof WikiCalloutKind)[keyof typeof WikiCalloutKind];

const CALLOUT_MARKER = /^\s*\[!(NOTE|TIP|WARNING)\][ \t]*\r?\n?/i;

/** Result of reading a callout marker at the start of a blockquote. */
export interface WikiCalloutMarker {
  readonly kind: WikiCalloutKind;
  /** The text after the marker. */
  readonly remainder: string;
}

/** Reads a leading `[!NOTE]` / `[!TIP]` / `[!WARNING]` marker (case-insensitive); null when absent. */
export function parseWikiCalloutMarker(text: string): WikiCalloutMarker | null {
  const match = CALLOUT_MARKER.exec(text);
  if (!match) return null;

  return {
    kind: match[1].toUpperCase() as WikiCalloutKind,
    remainder: text.slice(match[0].length),
  };
}
