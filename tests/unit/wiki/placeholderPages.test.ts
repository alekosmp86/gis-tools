import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { getWikiSources } from "@/app/wiki/wikiSources";
import { buildWikiIndex } from "@/core/wiki/buildWikiIndex";
import { nodeWikiFileSystem } from "@/core/wiki/nodeWikiFileSystem";
import type { WikiIndex } from "@/core/wiki/types";
import { MarkdownRenderer } from "@/ui-kit/components/wiki/MarkdownRenderer";

const PLACEHOLDER_SLUGS = [
  "db-shapefile-sync",
  "file-viewer",
  "db-table-viewer",
  "address-dedup",
  "cartography-watcher",
  "coverage-loads",
];

describe("placeholder wiki pages (tools without real content yet; remove a slug here once it gets real pages)", () => {
  let index: WikiIndex;

  beforeAll(async () => {
    index = await buildWikiIndex(getWikiSources(), nodeWikiFileSystem);
  });

  it.each(PLACEHOLDER_SLUGS)("should render %s/index as a Nota callout saying En construcción", (slug) => {
    const page = index.findPage(slug, "index");

    expect(page, slug).not.toBeNull();
    const html = renderToStaticMarkup(
      React.createElement(MarkdownRenderer, { body: page!.body, toolSlug: slug }),
    );

    expect(html).toContain("<aside");
    expect(html).toContain("<span>Nota</span>");
    expect(html).toContain("En construcción");
    expect(html).not.toContain("[!NOTE]");
  });
});
