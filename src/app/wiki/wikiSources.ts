import { moduleRegistry } from "@/app/modules.registry";
import { buildWikiIndex } from "@/core/wiki/buildWikiIndex";
import { nodeWikiFileSystem } from "@/core/wiki/nodeWikiFileSystem";
import type { WikiIndex, WikiSource } from "@/core/wiki/types";
import { toolsList } from "@/data/toolsData";

const LEGACY_WIKI_ROOT = "src/wiki";

/**
 * Every tool that owns wiki pages: legacy tools (core-owned `src/wiki/<slug>`) followed by the
 * sources each module declared in its manifest.
 */
export function getWikiSources(): ReadonlyArray<WikiSource> {
  const legacySources = toolsList.map((tool) => ({
    toolSlug: tool.wikiSlug,
    title: tool.title,
    contentDir: `${LEGACY_WIKI_ROOT}/${tool.wikiSlug}`,
  }));

  return [...legacySources, ...moduleRegistry.wikiSources()];
}

let wikiIndexPromise: Promise<WikiIndex> | null = null;

/** Server-side wiki index: built once per process in production, rebuilt on every call in development. */
export function getWikiIndex(): Promise<WikiIndex> {
  if (process.env.NODE_ENV !== "production") return buildWikiIndex(getWikiSources(), nodeWikiFileSystem);

  wikiIndexPromise ??= buildWikiIndex(getWikiSources(), nodeWikiFileSystem);
  return wikiIndexPromise;
}
