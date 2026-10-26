import { beforeAll, describe, expect, it } from "vitest";
import { getWikiSources } from "@/app/wiki/wikiSources";
import { buildWikiIndex } from "@/core/wiki/buildWikiIndex";
import { nodeWikiFileSystem } from "@/core/wiki/nodeWikiFileSystem";
import type { WikiPage } from "@/core/wiki/types";

const TOOL = "cartography-watcher";
const EXPECTED_PAGES = ["index", "fuentes-vigiladas", "catalogo-cartografico", "preguntas-frecuentes"];
const INDEX_LINK = /\]\(([a-z0-9-]+)\.md\)/g;

describe("cartography-watcher wiki content", () => {
  let pages: ReadonlyArray<WikiPage>;

  beforeAll(async () => {
    const index = await buildWikiIndex(getWikiSources(), nodeWikiFileSystem);
    pages = index.findTool(TOOL)?.pages ?? [];
  });

  it("should expose index plus the real topic pages in reading order", () => {
    expect(pages.map((page) => page.slug)).toEqual(EXPECTED_PAGES);
  });

  it("should give every page a non-empty title and a numeric order", () => {
    for (const page of pages) {
      expect(page.title.trim().length, page.slug).toBeGreaterThan(0);
      expect(Number.isFinite(page.order), page.slug).toBe(true);
    }
  });

  it("should use a unique order for every page", () => {
    const orders = pages.map((page) => page.order);

    expect(new Set(orders).size).toBe(orders.length);
  });

  it("should resolve every Markdown link of the index to an existing topic", () => {
    const index = pages.find((page) => page.slug === "index");
    const targets = [...(index?.body.matchAll(INDEX_LINK) ?? [])].map((match) => match[1]);

    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      expect(EXPECTED_PAGES, target).toContain(target);
    }
  });

  it("should contain no En construcción placeholder in any page", () => {
    for (const page of pages) {
      expect(page.body, page.slug).not.toContain("En construcción");
    }
  });
});
