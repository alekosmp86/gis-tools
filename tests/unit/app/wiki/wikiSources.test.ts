import { describe, expect, it } from "vitest";
import { moduleRegistry } from "@/app/modules.registry";
import { getWikiSources } from "@/app/wiki/wikiSources";
import { toolsList } from "@/data/toolsData";

const legacySlugs = toolsList.map((tool) => tool.wikiSlug);
const modulesWithWiki = moduleRegistry.modules.filter((manifest) => manifest.wiki !== undefined);

describe("getWikiSources", () => {
  it("should expose one source per legacy tool plus one per module declaring a wiki, with distinct valid slugs", () => {
    const sources = getWikiSources();
    const slugs = sources.map((s) => s.toolSlug);

    expect(sources).toHaveLength(legacySlugs.length + modulesWithWiki.length);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(slug).toMatch(/^[a-z][a-z0-9-]*$/);
  });

  it("should map legacy tools to src/wiki/<slug>", () => {
    const sources = getWikiSources();

    for (const slug of legacySlugs) {
      expect(sources.find((s) => s.toolSlug === slug)?.contentDir).toBe(`src/wiki/${slug}`);
    }
  });

  it("should include every module that declares a wiki, using its manifest data", () => {
    const sources = getWikiSources();

    for (const manifest of modulesWithWiki) {
      expect(sources.find((s) => s.toolSlug === manifest.id)).toEqual({
        toolSlug: manifest.id,
        contentDir: manifest.wiki!.contentDir,
        title: manifest.name,
      });
    }
  });

  it("should map module ids to src/modules/<id>/wiki", () => {
    const sources = getWikiSources();

    for (const manifest of modulesWithWiki) {
      expect(sources.find((s) => s.toolSlug === manifest.id)?.contentDir).toBe(`src/modules/${manifest.id}/wiki`);
    }
  });

  it("should not expose a source for modules that declare no wiki", () => {
    const slugs = getWikiSources().map((s) => s.toolSlug);
    const withoutWiki = moduleRegistry.modules.filter((manifest) => manifest.wiki === undefined);

    for (const manifest of withoutWiki) expect(slugs).not.toContain(manifest.id);
  });

  it("should give every source a non-empty title", () => {
    for (const source of getWikiSources()) expect(source.title.length).toBeGreaterThan(0);
  });
});
