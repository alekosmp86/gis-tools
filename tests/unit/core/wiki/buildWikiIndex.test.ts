import { describe, it, expect, vi } from "vitest";
import { buildWikiIndex } from "@/core/wiki/buildWikiIndex";
import type { WikiFileSystem, WikiSource } from "@/core/wiki/types";

function fakeFs(dirs: Record<string, string[]>, files: Record<string, string> = {}): WikiFileSystem {
  return {
    listMarkdownFileNames: async (directory) => {
      if (!(directory in dirs)) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return dirs[directory];
    },
    readUtf8File: async (filePath) => files[filePath] ?? "",
  };
}

const source = (toolSlug: string, title = toolSlug, contentDir = `c/${toolSlug}`): WikiSource => ({
  toolSlug,
  title,
  contentDir,
});

describe("buildWikiIndex", () => {
  it("should sort pages by order then title and default to the first", async () => {
    const fs = fakeFs(
      { "c/a": ["z.md", "b.md", "a.md", "m.md"] },
      {
        "c/a/z.md": "---\ntitle: First\norder: 1\n---\nz",
        "c/a/b.md": "---\ntitle: Beta\norder: 5\n---\nb",
        "c/a/a.md": "---\ntitle: Alpha\norder: 5\n---\na",
        "c/a/m.md": "no metadata",
      }
    );

    const index = await buildWikiIndex([source("a")], fs);

    expect(index.findTool("a")?.pages.map((p) => p.slug)).toEqual(["z", "a", "b", "m"]);
    expect(index.defaultPage("a")?.slug).toBe("z");
  });

  it("should default order to MAX_SAFE_INTEGER and title to the slug", async () => {
    const index = await buildWikiIndex([source("a")], fakeFs({ "c/a": ["intro.md"] }, { "c/a/intro.md": "x" }));

    const page = index.findPage("a", "intro");
    expect(page?.order).toBe(Number.MAX_SAFE_INTEGER);
    expect(page?.title).toBe("intro");
    expect(page?.toolSlug).toBe("a");
    expect(page?.body).toBe("x");
  });

  it("should sort tools by title", async () => {
    const fs = fakeFs({ "c/x": [], "c/y": [], "c/z": [] });

    const index = await buildWikiIndex([source("x", "Charlie"), source("y", "Alpha"), source("z", "Bravo")], fs);

    expect(index.tools().map((t) => t.title)).toEqual(["Alpha", "Bravo", "Charlie"]);
  });

  it("should throw on a duplicate tool slug", async () => {
    await expect(buildWikiIndex([source("a"), source("a")], fakeFs({}))).rejects.toThrow(
      /Duplicate wiki tool slug "a"/
    );
  });

  it.each(["Upper", "1abc", "snake_case", ""])("should throw on invalid tool slug %j", async (slug) => {
    await expect(buildWikiIndex([source(slug)], fakeFs({}))).rejects.toThrow(/Invalid wiki tool slug/);
  });

  it("should throw on a duplicate page slug within a tool", async () => {
    const fs = fakeFs({ "c/a": ["p.md", "p.md"] });

    await expect(buildWikiIndex([source("a")], fs)).rejects.toThrow(/Duplicate wiki page "p"/);
  });

  it("should yield a tool with zero pages when the directory is missing", async () => {
    const index = await buildWikiIndex([source("a")], fakeFs({}));

    expect(index.findTool("a")?.pages).toEqual([]);
    expect(index.defaultPage("a")).toBeNull();
  });

  it("should propagate errors other than ENOENT", async () => {
    const fs: WikiFileSystem = {
      listMarkdownFileNames: async () => {
        throw Object.assign(new Error("denied"), { code: "EACCES" });
      },
      readUtf8File: async () => "",
    };

    await expect(buildWikiIndex([source("a")], fs)).rejects.toThrow("denied");
  });

  it("should join contentDir and file name with trailing slashes trimmed", async () => {
    const readUtf8File = vi.fn(async () => "x");
    const fs: WikiFileSystem = { listMarkdownFileNames: async () => ["p.md"], readUtf8File };

    await buildWikiIndex([source("a", "A", "dir/sub//"), source("b", "B", "dir\\win\\")], fs);

    expect(readUtf8File).toHaveBeenCalledWith("dir/sub/p.md");
    expect(readUtf8File).toHaveBeenCalledWith("dir\\win/p.md");
  });

  it("should return null for unknown tools and pages", async () => {
    const index = await buildWikiIndex([source("a")], fakeFs({ "c/a": [] }));

    expect(index.findTool("nope")).toBeNull();
    expect(index.findPage("nope", "p")).toBeNull();
    expect(index.findPage("a", "p")).toBeNull();
    expect(index.defaultPage("nope")).toBeNull();
  });

  it.each(["Guía de uso.md", "A.md", "a b.md", "A.MD"])("should throw naming tool and file for page file %j", async (file) => {
    const fs = fakeFs({ "c/a": [file] });

    await expect(buildWikiIndex([source("a")], fs)).rejects.toThrow(
      `Invalid wiki page file "${file}" in tool "a". Page file names must be lowercase letters, digits, hyphens or underscores, followed by .md.`
    );
  });

  it.each([["a.md", "a"], ["a-b.md", "a-b"], ["a_b.md", "a_b"], ["1a.md", "1a"]])(
    "should accept page file %s",
    async (file, slug) => {
      const index = await buildWikiIndex([source("a")], fakeFs({ "c/a": [file] }, { [`c/a/${file}`]: "x" }));

      expect(index.findPage("a", slug)?.slug).toBe(slug);
    }
  );
});
