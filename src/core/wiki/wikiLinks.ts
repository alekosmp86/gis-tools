import { WIKI_MARKDOWN_EXTENSION_PATTERN } from "./constants";

const SCHEME_PREFIX = /^[a-z][a-z0-9+.-]*:/i;
const LEADING_CURRENT_DIR = /^(\.\/)+/;
const FENCE_LINE = /^\s{0,3}(```|~~~)/;
const REFERENCE_PATTERN = /(!?)\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;

const WIKI_ROUTE_ROOT = "/wiki";
const WIKI_ASSET_ROUTE_ROOT = "/api/wiki/assets";

/** Raw targets found in a Markdown body. */
export interface WikiReferences {
  readonly links: ReadonlyArray<string>;
  readonly images: ReadonlyArray<string>;
}

function isPassThroughTarget(target: string): boolean {
  return target.startsWith("/") || target.startsWith("#") || SCHEME_PREFIX.test(target);
}

/**
 * Rewrites a link found in a tool's page: relative `*.md` targets (optionally with `#anchor`)
 * become `/wiki/<toolSlug>/<slug>[#anchor]`. Absolute URLs, `/`-rooted paths, `mailto:` and
 * anchor-only targets are returned unchanged, as is any relative target that is not a `.md` file.
 */
export function rewriteWikiHref(toolSlug: string, href: string): string {
  if (isPassThroughTarget(href)) return href;

  const anchorIndex = href.indexOf("#");
  const pathPart = anchorIndex === -1 ? href : href.slice(0, anchorIndex);
  const anchorPart = anchorIndex === -1 ? "" : href.slice(anchorIndex);
  if (!WIKI_MARKDOWN_EXTENSION_PATTERN.test(pathPart)) return href;

  const pageSlug = pathPart.replace(LEADING_CURRENT_DIR, "").replace(WIKI_MARKDOWN_EXTENSION_PATTERN, "");
  return `${WIKI_ROUTE_ROOT}/${toolSlug}/${pageSlug}${anchorPart}`;
}

/**
 * Rewrites an image source found in a tool's page: a relative path becomes
 * `/api/wiki/assets/<toolSlug>/<path>`. Absolute URLs and `/`-rooted paths are returned unchanged.
 */
export function rewriteWikiImageSrc(toolSlug: string, src: string): string {
  if (isPassThroughTarget(src)) return src;
  return `${WIKI_ASSET_ROUTE_ROOT}/${toolSlug}/${src.replace(LEADING_CURRENT_DIR, "")}`;
}

function stripFencedCodeBlocks(body: string): string {
  let insideFence = false;
  const keptLines: string[] = [];

  for (const line of body.split(/\r?\n/)) {
    if (FENCE_LINE.test(line)) {
      insideFence = !insideFence;
      continue;
    }
    if (!insideFence) keptLines.push(line);
  }

  return keptLines.join("\n");
}

/**
 * Collects the raw targets of `[text](url)` links and `![alt](url)` images in a Markdown body,
 * ignoring anything inside fenced code blocks.
 */
export function extractWikiReferences(body: string): WikiReferences {
  const links: string[] = [];
  const images: string[] = [];

  for (const match of stripFencedCodeBlocks(body).matchAll(REFERENCE_PATTERN)) {
    const [, imageMarker, target] = match;
    (imageMarker === "!" ? images : links).push(target);
  }

  return { links, images };
}
