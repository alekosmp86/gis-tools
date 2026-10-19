import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveWikiAssetPath } from "@/core/wiki/resolveWikiAssetPath";

describe("resolveWikiAssetPath", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "wiki-asset-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it.each(["png", "jpg", "jpeg", "gif", "webp", "svg", "PNG", "JpG"])(
    "should resolve a .%s image inside the root",
    (ext) => {
      expect(resolveWikiAssetPath(root, [`pic.${ext}`])).toBe(path.join(root, `pic.${ext}`));
    }
  );

  it("should resolve nested segments", () => {
    expect(resolveWikiAssetPath(root, ["img", "deep", "a.png"])).toBe(path.join(root, "img", "deep", "a.png"));
  });

  it("should return null for an empty segments array", () => {
    expect(resolveWikiAssetPath(root, [])).toBeNull();
  });

  it.each([
    ["empty segment", ["", "a.png"]],
    ["dot segment", [".", "a.png"]],
    ["dotdot segment", ["..", "a.png"]],
    ["traversal in the middle", ["img", "..", "..", "a.png"]],
    ["forward slash", ["a/b.png"]],
    ["backslash", ["a\\b.png"]],
    ["NUL byte", ["a\0.png"]],
    ["percent-encoded traversal", ["%2e%2e", "a.png"]],
    ["percent in file name", ["a%20b.png"]],
    ["drive letter", ["C:", "a.png"]],
    ["colon in file name", ["C:a.png"]],
    ["markdown extension", ["page.md"]],
    ["text extension", ["a.txt"]],
    ["double extension", ["a.png.exe"]],
    ["no extension", ["a"]],
  ])("should return null for %s", (_label, segments) => {
    expect(resolveWikiAssetPath(root, segments)).toBeNull();
  });
});
