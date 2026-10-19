const SVG_CONTENT_TYPE = "image/svg+xml";

const BASE_HEADERS: Readonly<Record<string, string>> = {
  "Cache-Control": "public, max-age=300",
  "X-Content-Type-Options": "nosniff",
};

const SVG_HEADERS: Readonly<Record<string, string>> = {
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
};

/**
 * Response headers for a served wiki image. Every type gets `nosniff` and a short cache; SVG,
 * which can carry script, additionally gets a CSP that blocks everything but inline styles.
 */
export function buildWikiAssetHeaders(contentType: string): Record<string, string> {
  return {
    "Content-Type": contentType,
    ...BASE_HEADERS,
    ...(contentType === SVG_CONTENT_TYPE ? SVG_HEADERS : {}),
  };
}
