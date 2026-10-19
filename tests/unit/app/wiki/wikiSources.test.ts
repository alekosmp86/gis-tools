import { describe, expect, it } from "vitest";
import { getWikiSources } from "@/app/wiki/wikiSources";

const LEGACY = ["db-shapefile-sync", "db-csv-sync", "db-db-sync", "file-viewer", "db-table-viewer"];
const MODULES = ["address-dedup", "cartography-watcher", "coverage-loads"];

describe("getWikiSources", () => {
  it("should expose eight sources with distinct valid slugs", () => {
    const sources = getWikiSources();
    const slugs = sources.map((s) => s.toolSlug);

    expect(sources).toHaveLength(8);
    expect(new Set(slugs).size).toBe(8);
    for (const slug of slugs) expect(slug).toMatch(/^[a-z][a-z0-9-]*$/);
  });

  it("should map legacy tools to src/wiki/<slug>", () => {
    const sources = getWikiSources();

    for (const slug of LEGACY) {
      expect(sources.find((s) => s.toolSlug === slug)?.contentDir).toBe(`src/wiki/${slug}`);
    }
  });

  it("should map module ids to src/modules/<id>/wiki", () => {
    const sources = getWikiSources();

    for (const id of MODULES) {
      expect(sources.find((s) => s.toolSlug === id)?.contentDir).toBe(`src/modules/${id}/wiki`);
    }
  });

  it("should give every source a non-empty title", () => {
    for (const source of getWikiSources()) expect(source.title.length).toBeGreaterThan(0);
  });
});
