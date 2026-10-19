import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { nodeWikiFileSystem } from "@/core/wiki/nodeWikiFileSystem";

describe("nodeWikiFileSystem", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "wiki-fs-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("should list only .md files, sorted, ignoring other files and subdirectories", async () => {
    await writeFile(path.join(dir, "b.md"), "b");
    await writeFile(path.join(dir, "a.md"), "a");
    await writeFile(path.join(dir, "pic.png"), "x");
    await writeFile(path.join(dir, "notes.txt"), "x");
    await mkdir(path.join(dir, "folder.md"));
    await mkdir(path.join(dir, "sub"));
    await writeFile(path.join(dir, "sub", "c.md"), "c");

    const names = await nodeWikiFileSystem.listMarkdownFileNames(dir);

    expect(names).toEqual(["a.md", "b.md"]);
  });

  it("should list the extension case-insensitively", async () => {
    await writeFile(path.join(dir, "A.MD"), "a");
    await writeFile(path.join(dir, "b.md"), "b");
    await writeFile(path.join(dir, "c.txt"), "c");

    const names = await nodeWikiFileSystem.listMarkdownFileNames(dir);

    expect(names).toEqual(["A.MD", "b.md"]);
  });

  it("should read a file as UTF-8", async () => {
    const file = path.join(dir, "a.md");
    await writeFile(file, "héllo", "utf8");

    await expect(nodeWikiFileSystem.readUtf8File(file)).resolves.toBe("héllo");
  });

  it("should reject with ENOENT when the directory is missing", async () => {
    await expect(nodeWikiFileSystem.listMarkdownFileNames(path.join(dir, "missing"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
