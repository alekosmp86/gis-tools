import { WIKI_MARKDOWN_EXTENSION } from "./constants";
import { parseWikiFrontmatter } from "./frontmatter";
import type { WikiFileSystem, WikiIndex, WikiPage, WikiSource, WikiTool } from "./types";

/** Tool slugs become URL segments, so they are constrained like module ids. */
const VALID_TOOL_SLUG = /^[a-z][a-z0-9-]*$/;
const VALID_PAGE_SLUG = /^[a-z0-9][a-z0-9_-]*$/;
const MISSING_ENTRY_CODE = "ENOENT";

function assertValidSources(sources: ReadonlyArray<WikiSource>): void {
  const seenSlugs = new Set<string>();

  for (const source of sources) {
    if (!VALID_TOOL_SLUG.test(source.toolSlug)) {
      throw new Error(
        `Invalid wiki tool slug "${source.toolSlug}". Slugs become URL segments, so they must be lowercase and may contain only letters, digits and hyphens.`
      );
    }
    if (seenSlugs.has(source.toolSlug)) {
      throw new Error(`Duplicate wiki tool slug "${source.toolSlug}". Each tool may declare its wiki once.`);
    }
    seenSlugs.add(source.toolSlug);
  }
}

function isMissingEntryError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === MISSING_ENTRY_CODE;
}

function joinPath(directory: string, fileName: string): string {
  return `${directory.replace(/[\\/]+$/, "")}/${fileName}`;
}

function comparePages(first: WikiPage, second: WikiPage): number {
  return first.order - second.order || first.title.localeCompare(second.title);
}

async function loadPages(source: WikiSource, fileSystem: WikiFileSystem): Promise<ReadonlyArray<WikiPage>> {
  let fileNames: ReadonlyArray<string>;
  try {
    fileNames = await fileSystem.listMarkdownFileNames(source.contentDir);
  } catch (error) {
    if (isMissingEntryError(error)) return [];
    throw error;
  }

  const seenSlugs = new Set<string>();
  const pages: WikiPage[] = [];

  for (const fileName of fileNames) {
    const slug = fileName.slice(0, -WIKI_MARKDOWN_EXTENSION.length);
    if (!VALID_PAGE_SLUG.test(slug)) {
      throw new Error(
        `Invalid wiki page file "${fileName}" in tool "${source.toolSlug}". Page file names must be lowercase letters, digits, hyphens or underscores, followed by ${WIKI_MARKDOWN_EXTENSION}.`
      );
    }
    if (seenSlugs.has(slug)) {
      throw new Error(`Duplicate wiki page "${slug}" in tool "${source.toolSlug}".`);
    }
    seenSlugs.add(slug);

    const filePath = joinPath(source.contentDir, fileName);
    const { metadata, body } = parseWikiFrontmatter(await fileSystem.readUtf8File(filePath), filePath);
    pages.push({
      toolSlug: source.toolSlug,
      slug,
      title: metadata.title ?? slug,
      order: metadata.order ?? Number.MAX_SAFE_INTEGER,
      body,
    });
  }

  return pages.sort(comparePages);
}

/**
 * Reads every source and builds the wiki read model.
 *
 * Invalid or duplicate tool slugs and duplicate page slugs throw, so a misconfigured wiki fails at
 * build rather than serving an ambiguous URL. A source whose directory does not exist is a tool
 * with no pages, which is what a wiki not yet written looks like.
 */
export async function buildWikiIndex(
  sources: ReadonlyArray<WikiSource>,
  fileSystem: WikiFileSystem
): Promise<WikiIndex> {
  assertValidSources(sources);

  const tools: WikiTool[] = await Promise.all(
    sources.map(async (source) => ({
      toolSlug: source.toolSlug,
      title: source.title,
      pages: await loadPages(source, fileSystem),
    }))
  );
  tools.sort((first, second) => first.title.localeCompare(second.title));

  const toolsBySlug = new Map(tools.map((tool) => [tool.toolSlug, tool]));

  return {
    tools: () => tools,
    findTool: (toolSlug) => toolsBySlug.get(toolSlug) ?? null,
    findPage: (toolSlug, pageSlug) =>
      toolsBySlug.get(toolSlug)?.pages.find((page) => page.slug === pageSlug) ?? null,
    defaultPage: (toolSlug) => toolsBySlug.get(toolSlug)?.pages[0] ?? null,
  };
}
