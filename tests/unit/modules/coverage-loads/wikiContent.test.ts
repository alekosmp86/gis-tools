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

const TOOL = "coverage-loads";
const IMAGES_DIR = path.join(process.cwd(), "src", "modules", "coverage-loads", "wiki", "images");
const EXPECTED_PAGES = [
  "index",
  "conexion",
  "indicadores-lte",
  "cargas-geometrias",
  "resultado-y-reportes",
  "preguntas-frecuentes",
];

function render(page: WikiPage): string {
  return renderToStaticMarkup(React.createElement(MarkdownRenderer, { body: page.body, toolSlug: TOOL }));
}

describe("coverage-loads wiki content", () => {
  let index: WikiIndex;
  let pages: ReadonlyArray<WikiPage>;

  beforeAll(async () => {
    index = await buildWikiIndex(getWikiSources(), nodeWikiFileSystem);
    pages = index.findTool(TOOL)?.pages ?? [];
  });

  it("should expose exactly the six real pages in reading order", () => {
    expect(pages.map((p) => p.slug)).toEqual(EXPECTED_PAGES);
  });

  it("should contain no En construcción placeholder in any page", () => {
    for (const page of pages) {
      expect(page.body, page.slug).not.toContain("En construcción");
    }
  });

  it("should hold exactly 18 screenshots and reference each from at least one page", () => {
    const files = readdirSync(IMAGES_DIR).filter((f) => f.endsWith(".png"));
    const allBodies = pages.map((p) => p.body).join("\n");

    expect(files).toHaveLength(18);
    const orphans = files.filter((f) => !allBodies.includes(f));
    expect(orphans).toEqual([]);
  });

  it("should render indicadores-lte with an Advertencia callout and wiki-asset images", () => {
    const html = render(index.findPage(TOOL, "indicadores-lte")!);

    expect(html).toContain("<span>Advertencia</span>");
    expect(html).toMatch(/<img[^>]+src="\/api\/wiki\/assets\/coverage-loads\/images\//);
  });

  it("should render index with a table", () => {
    const html = render(index.findPage(TOOL, "index")!);

    expect(html).toContain("<table");
  });

  it("should render preguntas-frecuentes with a table and a GRANT code block that grants DELETE and never TRUNCATE", () => {
    const html = render(index.findPage(TOOL, "preguntas-frecuentes")!);
    const codeBlocks = [...html.matchAll(/<pre[\s\S]*?<\/pre>/g)].map((match) => match[0]);

    expect(html).toContain("<table");
    expect(html).toMatch(/<pre[\s\S]*GRANT[^<]*DELETE[\s\S]*<\/pre>/);
    expect(codeBlocks.some((block) => /GRANT/.test(block))).toBe(true);
    for (const block of codeBlocks) expect(block).not.toMatch(/TRUNCATE/);
  });

  it("should render conexion with a link to the db-db-sync conexion page", () => {
    const html = render(index.findPage(TOOL, "conexion")!);

    expect(html).toMatch(/<a[^>]+href="\/wiki\/db-db-sync\/conexion"/);
  });
});
