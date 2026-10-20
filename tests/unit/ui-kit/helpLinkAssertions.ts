import { expect } from "vitest";

function countOf(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

export function expectSingleHelpLink(html: string, slug: string, label: string): void {
  expect(countOf(html, 'href="/wiki/')).toBe(1);
  expect(html).toContain(`href="/wiki/${slug}"`);
  expect(html).toContain(`aria-label="Ayuda: ${label}"`);
  expect(html).toContain('title="Ayuda"');
}

/** At the help link, no other anchor may be open: every `<a` before it has already been closed. */
export function expectHelpLinkNotNested(html: string): void {
  const before = html.slice(0, html.indexOf('href="/wiki/'));
  const openedAnchors = countOf(before, "<a ") + countOf(before, "<a>");
  expect(countOf(before, "</a>")).toBe(openedAnchors - 1);
}

export function countOccurrences(html: string, needle: string): number {
  return countOf(html, needle);
}
