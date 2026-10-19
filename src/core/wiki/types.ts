/** A tool that owns wiki pages: where its Markdown lives and how it is titled. */
export interface WikiSource {
  readonly toolSlug: string;
  readonly title: string;
  /** Repo-relative (or absolute) directory holding the tool's `.md` pages and images. */
  readonly contentDir: string;
}

/** One parsed wiki page. */
export interface WikiPage {
  readonly toolSlug: string;
  /** File name without the `.md` extension. */
  readonly slug: string;
  readonly title: string;
  readonly order: number;
  readonly body: string;
}

/** A tool and its pages, already ordered by `order` then title. */
export interface WikiTool {
  readonly toolSlug: string;
  readonly title: string;
  readonly pages: ReadonlyArray<WikiPage>;
}

/** The only file-system access the engine needs, injectable so tests can fake it. */
export interface WikiFileSystem {
  /** Names (not paths) of the `.md` files directly inside the directory. Rejects with ENOENT when missing. */
  listMarkdownFileNames(directory: string): Promise<ReadonlyArray<string>>;
  readUtf8File(filePath: string): Promise<string>;
}

/** Read model over the built index. Query-only. */
export interface WikiIndex {
  tools(): ReadonlyArray<WikiTool>;
  findTool(toolSlug: string): WikiTool | null;
  findPage(toolSlug: string, pageSlug: string): WikiPage | null;
  /** The tool's first page, or null when the tool has none or does not exist. */
  defaultPage(toolSlug: string): WikiPage | null;
}
