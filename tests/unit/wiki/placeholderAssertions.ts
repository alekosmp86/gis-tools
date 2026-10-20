import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect } from "vitest";
import { getWikiSources } from "@/app/wiki/wikiSources";
import { buildWikiIndex } from "@/core/wiki/buildWikiIndex";
import { nodeWikiFileSystem } from "@/core/wiki/nodeWikiFileSystem";
import { MarkdownRenderer } from "@/ui-kit/components/wiki/MarkdownRenderer";

export async function expectPlaceholderIndexPage(slug: string): Promise<void> {
  const index = await buildWikiIndex(getWikiSources(), nodeWikiFileSystem);
  const page = index.findPage(slug, "index");

  expect(page, slug).not.toBeNull();
  const html = renderToStaticMarkup(React.createElement(MarkdownRenderer, { body: page!.body, toolSlug: slug }));

  expect(html).toContain("<aside");
  expect(html).toContain("<span>Nota</span>");
  expect(html).toContain("En construcción");
  expect(html).not.toContain("[!NOTE]");
}
