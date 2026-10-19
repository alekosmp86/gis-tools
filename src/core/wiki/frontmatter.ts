/** Metadata read from a page's leading frontmatter block. */
export interface WikiFrontmatter {
  readonly title?: string;
  readonly order?: number;
}

/** A document split into its metadata and the Markdown that follows the block. */
export interface ParsedWikiDocument {
  readonly metadata: WikiFrontmatter;
  readonly body: string;
}

const FRONTMATTER_DELIMITER = "---";
const INTEGER_PATTERN = /^-?\d+$/;
const QUOTE_CHARACTERS: ReadonlySet<string> = new Set(['"', "'"]);

const FrontmatterKey = {
  TITLE: "title",
  ORDER: "order",
} as const;

function stripSurroundingQuotes(value: string): string {
  const firstCharacter = value.charAt(0);
  const isQuoted =
    value.length >= 2 && QUOTE_CHARACTERS.has(firstCharacter) && firstCharacter === value.charAt(value.length - 1);
  return isQuoted ? value.slice(1, -1) : value;
}

function parseOrder(rawValue: string, fileName: string): number {
  if (!INTEGER_PATTERN.test(rawValue)) {
    throw new Error(`Invalid frontmatter "order" in "${fileName}": expected an integer, got "${rawValue}".`);
  }
  return Number.parseInt(rawValue, 10);
}

/**
 * Splits a Markdown document into its frontmatter metadata and body.
 *
 * Only a leading `---` block with `title:` and `order:` lines is understood; unknown keys are
 * ignored. A missing or unterminated block yields no metadata and the whole text as body.
 * A non-integer `order` throws, naming the file, so a typo fails at index build.
 */
export function parseWikiFrontmatter(source: string, fileName: string): ParsedWikiDocument {
  const lines = source.replace(/^﻿/, "").split(/\r?\n/);

  if (lines[0]?.trim() !== FRONTMATTER_DELIMITER) {
    return { metadata: {}, body: lines.join("\n") };
  }

  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === FRONTMATTER_DELIMITER);
  if (closingIndex === -1) {
    return { metadata: {}, body: lines.join("\n") };
  }

  let title: string | undefined;
  let order: number | undefined;

  for (const line of lines.slice(1, closingIndex)) {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) continue;

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();

    if (key === FrontmatterKey.TITLE) {
      const unquoted = stripSurroundingQuotes(value);
      title = unquoted.length > 0 ? unquoted : undefined;
    } else if (key === FrontmatterKey.ORDER) {
      order = parseOrder(value, fileName);
    }
  }

  return {
    metadata: { title, order },
    body: lines.slice(closingIndex + 1).join("\n"),
  };
}
