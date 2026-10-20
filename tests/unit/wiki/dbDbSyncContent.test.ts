import { readdirSync } from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { getWikiSources } from "@/app/wiki/wikiSources";
import { buildWikiIndex } from "@/core/wiki/buildWikiIndex";
import { nodeWikiFileSystem } from "@/core/wiki/nodeWikiFileSystem";
import type { WikiIndex, WikiPage } from "@/core/wiki/types";
import { MarkdownRenderer } from "@/ui-kit/components/wiki/MarkdownRenderer";

const TOOL = "db-db-sync";
const IMAGES_DIR = path.join(process.cwd(), "src", "wiki", TOOL, "images");
const EXPECTED_PAGES = ["index", "conexion", "comparar", "reemplazo-completo", "preguntas-frecuentes"];

function render(page: WikiPage): string {
  return renderToStaticMarkup(React.createElement(MarkdownRenderer, { body: page.body, toolSlug: TOOL }));
}

describe("db-db-sync wiki content", () => {
  let index: WikiIndex;
  let pages: ReadonlyArray<WikiPage>;

  beforeAll(async () => {
    index = await buildWikiIndex(getWikiSources(), nodeWikiFileSystem);
    pages = index.findTool(TOOL)?.pages ?? [];
  });

  it("should expose exactly the five real pages in reading order", () => {
    expect(pages.map((p) => p.slug)).toEqual(EXPECTED_PAGES);
  });

  it("should contain no En construcción placeholder in any page", () => {
    for (const page of pages) {
      expect(page.body, page.slug).not.toContain("En construcción");
    }
  });

  it("should reference every screenshot in the images folder from at least one page", () => {
    const files = readdirSync(IMAGES_DIR).filter((f) => f.endsWith(".png"));
    const allBodies = pages.map((p) => p.body).join("\n");

    expect(files).toHaveLength(14);
    const orphans = files.filter((f) => !allBodies.includes(f));
    expect(orphans).toEqual([]);
  });

  it("should render reemplazo-completo with an Advertencia callout and wiki-asset images", () => {
    const html = render(index.findPage(TOOL, "reemplazo-completo")!);

    expect(html).toContain("<span>Advertencia</span>");
    expect(html).toMatch(/<img[^>]+src="\/api\/wiki\/assets\/db-db-sync\/images\//);
  });

  it("should render index with a table", () => {
    const html = render(index.findPage(TOOL, "index")!);

    expect(html).toContain("<table");
  });
});
