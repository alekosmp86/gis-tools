import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { readWikiAsset } from "@/core/wiki/readWikiAsset";

const CONTENT_DIR = path.resolve("tmp-wiki-content");
const BYTES = new Uint8Array([1, 2, 3]);

function fakeReader() {
  return vi.fn(async () => BYTES);
}

describe("readWikiAsset", () => {
  it("should return bytes and image/png for a png", async () => {
    const reader = fakeReader();

    const asset = await readWikiAsset(CONTENT_DIR, ["img", "a.png"], reader);

    expect(asset).toEqual({ bytes: BYTES, contentType: "image/png" });
    expect(reader).toHaveBeenCalledWith(path.join(CONTENT_DIR, "img", "a.png"));
  });

  it.each([
    ["a.PNG", "image/png"],
    ["a.jpg", "image/jpeg"],
    ["a.jpeg", "image/jpeg"],
    ["a.JPG", "image/jpeg"],
    ["a.svg", "image/svg+xml"],
    ["a.webp", "image/webp"],
    ["a.gif", "image/gif"],
  ])("should map %s to %s", async (name, contentType) => {
    const asset = await readWikiAsset(CONTENT_DIR, [name], fakeReader());

    expect(asset?.contentType).toBe(contentType);
  });

  it.each([
    ["parent traversal", ["..", "secret.png"]],
    ["nested traversal", ["img", "..", "..", "x.png"]],
    ["absolute path", ["/etc/passwd.png"]],
    ["drive path", ["C:", "x.png"]],
    ["percent-encoded traversal", ["%2e%2e", "x.png"]],
    ["empty segments", []],
  ])("should return null and never read for %s", async (_label, segments) => {
    const reader = fakeReader();

    expect(await readWikiAsset(CONTENT_DIR, segments, reader)).toBeNull();
    expect(reader).not.toHaveBeenCalled();
  });

  it.each(["notes.md", "script.js", "noext", "a.png.exe"])(
    "should return null and never read for non-image %s",
    async (name) => {
      const reader = fakeReader();

      expect(await readWikiAsset(CONTENT_DIR, [name], reader)).toBeNull();
      expect(reader).not.toHaveBeenCalled();
    },
  );

  it("should return null when the reader rejects", async () => {
    const reader = vi.fn(async (): Promise<Uint8Array> => {
      throw new Error("ENOENT");
    });

    expect(await readWikiAsset(CONTENT_DIR, ["a.png"], reader)).toBeNull();
    expect(reader).toHaveBeenCalledOnce();
  });
});
