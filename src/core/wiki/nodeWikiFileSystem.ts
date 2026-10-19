import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { WIKI_MARKDOWN_EXTENSION_PATTERN } from "./constants";
import type { WikiFileSystem } from "./types";

/*
 * The wiki reads repo content at runtime by design, so the dynamic paths are excluded from
 * Turbopack's file tracing (otherwise it traces the whole project).
 */

/** Reads wiki content from disk; relative directories resolve against `process.cwd()`. */
export const nodeWikiFileSystem: WikiFileSystem = {
  async listMarkdownFileNames(directory) {
    const entries = await readdir(path.resolve(/*turbopackIgnore: true*/ process.cwd(), directory), {
      withFileTypes: true,
    });
    const fileNames: string[] = [];
    for (const entry of entries) {
      if (entry.isFile() && WIKI_MARKDOWN_EXTENSION_PATTERN.test(entry.name)) fileNames.push(entry.name);
    }
    return fileNames.sort();
  },
  readUtf8File: (filePath) => readFile(path.resolve(/*turbopackIgnore: true*/ process.cwd(), filePath), "utf8"),
};
