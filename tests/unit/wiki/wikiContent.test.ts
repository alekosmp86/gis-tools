import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { getWikiSources } from "@/app/wiki/wikiSources";
import { buildWikiIndex } from "@/core/wiki/buildWikiIndex";
import { parseWikiFrontmatter } from "@/core/wiki/frontmatter";
import { nodeWikiFileSystem } from "@/core/wiki/nodeWikiFileSystem";
import { resolveWikiAssetPath } from "@/core/wiki/resolveWikiAssetPath";
import type { WikiIndex, WikiSource } from "@/core/wiki/types";
import { extractWikiReferences, rewriteWikiHref } from "@/core/wiki/wikiLinks";

type FileExists = (absolutePath: string) => boolean;

const WIKI_ROUTE_PREFIX = "/wiki/";
const SCHEME_OR_ROOTED = /^([a-z][a-z0-9+.-]*:|\/|#)/i;

/** Raw frontmatter titles keyed by `<tool>/<slug>`; the index falls back to the slug so it cannot prove a title exists. */
type RawTitles = ReadonlyMap<string, string | undefined>;

/**
 * Returns one human-readable problem per broken link, missing image or missing title.
 * Pure over its inputs so the negative tests can drive it with a fake index.
 */
function findWikiContentProblems(
  sources: ReadonlyArray<WikiSource>,
  index: WikiIndex,
  rawTitles: RawTitles,
  fileExists: FileExists,
): string[] {
  const problems: string[] = [];

  for (const source of sources) {
    const tool = index.findTool(source.toolSlug);
    if (!tool) {
      problems.push(`${source.toolSlug}: tool missing from index`);
      continue;
    }
    if (tool.pages.length === 0) problems.push(`${tool.toolSlug}: has no pages`);

    const slugs = tool.pages.map((page) => page.slug);
    if (new Set(slugs).size !== slugs.length) problems.push(`${tool.toolSlug}: duplicate page slug`);

    for (const page of tool.pages) {
      const where = `${tool.toolSlug}/${page.slug}`;
      if (!rawTitles.get(where)?.trim()) problems.push(`${where}: missing frontmatter title`);

      const { links, images } = extractWikiReferences(page.body);

      for (const link of links) {
        const rewritten = rewriteWikiHref(tool.toolSlug, link);
        if (rewritten.startsWith(WIKI_ROUTE_PREFIX)) {
          const [toolSlug, pageSlug] = rewritten.slice(WIKI_ROUTE_PREFIX.length).split("#")[0].split("/");
          const resolves = pageSlug ? index.findPage(toolSlug, pageSlug) : index.findTool(toolSlug);
          if (!resolves) problems.push(`${where}: broken link "${link}"`);
        } else if (!SCHEME_OR_ROOTED.test(link)) {
          const target = path.resolve(source.contentDir, link.split("#")[0]);
          if (!fileExists(target)) problems.push(`${where}: broken file link "${link}"`);
        }
      }

      for (const image of images) {
        if (SCHEME_OR_ROOTED.test(image)) continue;
        const resolved = resolveWikiAssetPath(source.contentDir, image.replace(/^\.\//, "").split("/"));
        if (!resolved || !fileExists(resolved)) problems.push(`${where}: missing image "${image}"`);
      }
    }
  }

  return problems;
}

async function loadRawTitles(sources: ReadonlyArray<WikiSource>, index: WikiIndex): Promise<RawTitles> {
  const titles = new Map<string, string | undefined>();
  for (const source of sources) {
    for (const page of index.findTool(source.toolSlug)?.pages ?? []) {
      const filePath = path.join(source.contentDir, `${page.slug}.md`);
      const { metadata } = parseWikiFrontmatter(await readFile(path.resolve(filePath), "utf8"), filePath);
      titles.set(`${source.toolSlug}/${page.slug}`, metadata.title);
    }
  }
  return titles;
}

describe("wiki content (real repository files)", () => {
  const sources = getWikiSources();
  let index: WikiIndex;
  let rawTitles: RawTitles;

  beforeAll(async () => {
    index = await buildWikiIndex(sources, nodeWikiFileSystem);
    rawTitles = await loadRawTitles(sources, index);
  });

  it("should declare all nine sources", () => {
    expect(sources).toHaveLength(9);
    expect(index.tools()).toHaveLength(9);
  });

  it("should give every tool at least one page", () => {
    for (const tool of index.tools()) expect(tool.pages.length, tool.toolSlug).toBeGreaterThanOrEqual(1);
  });

  it("should give every page a non-empty frontmatter title", () => {
    for (const [key, title] of rawTitles) expect(title?.trim(), key).toBeTruthy();
  });

  it("should have unique page slugs per tool", () => {
    for (const tool of index.tools()) {
      const slugs = tool.pages.map((page) => page.slug);
      expect(new Set(slugs).size, tool.toolSlug).toBe(slugs.length);
    }
  });

  it("should have no broken internal links, files or images", () => {
    expect(findWikiContentProblems(sources, index, rawTitles, existsSync)).toEqual([]);
  });
});

describe("findWikiContentProblems", () => {
  const source: WikiSource = { toolSlug: "t", title: "T", contentDir: "src/wiki/t" };

  function indexWith(pages: Array<{ slug: string; title?: string; body: string }>): WikiIndex {
    const built = pages.map((page, order) => ({
      toolSlug: "t",
      slug: page.slug,
      title: page.title ?? page.slug,
      order,
      body: page.body,
    }));
    const tool = { toolSlug: "t", title: "T", pages: built };
    return {
      tools: () => [tool],
      findTool: (slug) => (slug === "t" ? tool : null),
      findPage: (slug, pageSlug) => (slug === "t" ? (built.find((p) => p.slug === pageSlug) ?? null) : null),
      defaultPage: () => built[0] ?? null,
    };
  }

  const titles = (...slugs: string[]): RawTitles => new Map(slugs.map((slug) => [`t/${slug}`, "Titulo"]));
  const nothingExists: FileExists = () => false;

  it("should report no problems for valid content", () => {
    const index = indexWith([
      { slug: "a", body: "[b](b.md#x) [web](https://e.com) [top](#a) ![i](img/i.png)" },
      { slug: "b", body: "texto" },
    ]);
    const exists: FileExists = (file) => file.endsWith("i.png");

    expect(findWikiContentProblems([source], index, titles("a", "b"), exists)).toEqual([]);
  });

  it("should report a broken internal link", () => {
    const index = indexWith([{ slug: "a", body: "[x](ghost.md)" }]);

    expect(findWikiContentProblems([source], index, titles("a"), nothingExists)).toEqual([
      't/a: broken link "ghost.md"',
    ]);
  });

  it("should report a link to a page of an unknown tool", () => {
    const index = indexWith([{ slug: "a", body: "[x](/wiki/other/p)" }]);

    expect(findWikiContentProblems([source], index, titles("a"), nothingExists)).toEqual([
      't/a: broken link "/wiki/other/p"',
    ]);
  });

  it("should accept a tool-root link to a known tool and report one to an unknown tool", () => {
    const index = indexWith([{ slug: "a", body: "[ok](/wiki/t) [bad](/wiki/ghost)" }]);

    expect(findWikiContentProblems([source], index, titles("a"), nothingExists)).toEqual([
      't/a: broken link "/wiki/ghost"',
    ]);
  });

  it("should report a broken relative file link", () => {
    const index = indexWith([{ slug: "a", body: "[doc](files/doc.pdf)" }]);

    expect(findWikiContentProblems([source], index, titles("a"), nothingExists)).toEqual([
      't/a: broken file link "files/doc.pdf"',
    ]);
  });

  it("should report a missing image", () => {
    const index = indexWith([{ slug: "a", body: "![i](img/missing.png)" }]);

    expect(findWikiContentProblems([source], index, titles("a"), nothingExists)).toEqual([
      't/a: missing image "img/missing.png"',
    ]);
  });

  it("should report an image path that escapes the content directory", () => {
    const index = indexWith([{ slug: "a", body: "![i](../../secret.png)" }]);

    expect(findWikiContentProblems([source], index, titles("a"), () => true)).toEqual([
      't/a: missing image "../../secret.png"',
    ]);
  });

  it("should report a missing or blank frontmatter title", () => {
    const index = indexWith([
      { slug: "a", body: "x" },
      { slug: "b", body: "x" },
    ]);
    const rawTitles: RawTitles = new Map([
      ["t/a", undefined],
      ["t/b", "   "],
    ]);

    expect(findWikiContentProblems([source], index, rawTitles, nothingExists)).toEqual([
      "t/a: missing frontmatter title",
      "t/b: missing frontmatter title",
    ]);
  });

  it("should report a tool with no pages", () => {
    expect(findWikiContentProblems([source], indexWith([]), titles(), nothingExists)).toEqual(["t: has no pages"]);
  });

  it("should report a source absent from the index", () => {
    const missing: WikiSource = { toolSlug: "zzz", title: "Z", contentDir: "src/wiki/zzz" };

    expect(findWikiContentProblems([missing], indexWith([]), titles(), nothingExists)).toEqual([
      "zzz: tool missing from index",
    ]);
  });

  it("should not flag links inside code fences", () => {
    const index = indexWith([{ slug: "a", body: "```\n[x](ghost.md)\n![i](nope.png)\n```" }]);

    expect(findWikiContentProblems([source], index, titles("a"), nothingExists)).toEqual([]);
  });
});
