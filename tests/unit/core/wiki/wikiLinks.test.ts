import { describe, expect, it } from "vitest";
import { extractWikiReferences, rewriteWikiHref, rewriteWikiImageSrc } from "@/core/wiki/wikiLinks";

describe("rewriteWikiHref", () => {
  it.each([
    ["a.md", "/wiki/tool/a"],
    ["./a.md", "/wiki/tool/a"],
    ["a.md#x", "/wiki/tool/a#x"],
    ["./a.md#x", "/wiki/tool/a#x"],
    ["a.MD", "/wiki/tool/a"],
  ])("should rewrite %s to %s", (href, expected) => {
    expect(rewriteWikiHref("tool", href)).toBe(expected);
  });

  it.each(["https://example.com/a.md", "mailto:a@b.com", "/abs/a.md", "#only", "doc.pdf", "img/a.png", ""])(
    "should leave %j unchanged",
    (href) => {
      expect(rewriteWikiHref("tool", href)).toBe(href);
    },
  );
});

describe("rewriteWikiImageSrc", () => {
  it.each(["img/a.png", "./img/a.png"])("should route %s through the asset API", (src) => {
    expect(rewriteWikiImageSrc("tool", src)).toBe("/api/wiki/assets/tool/img/a.png");
  });

  it.each(["https://x.com/a.png", "http://x.com/a.png", "/public/a.png"])("should leave %s unchanged", (src) => {
    expect(rewriteWikiImageSrc("tool", src)).toBe(src);
  });
});

describe("extractWikiReferences", () => {
  it("should separate links from images", () => {
    const refs = extractWikiReferences("[a](x.md) and ![b](img/b.png) and [c](https://e.com)");

    expect(refs.links).toEqual(["x.md", "https://e.com"]);
    expect(refs.images).toEqual(["img/b.png"]);
  });

  it("should return empty lists for an empty body", () => {
    expect(extractWikiReferences("")).toEqual({ links: [], images: [] });
  });

  it("should ignore targets inside backtick fences", () => {
    const refs = extractWikiReferences("```\n[a](no.md)\n![i](no.png)\n```\n[b](yes.md)");

    expect(refs).toEqual({ links: ["yes.md"], images: [] });
  });

  it("should ignore targets inside tilde fences", () => {
    const refs = extractWikiReferences("~~~\n[a](no.md)\n~~~\n![i](yes.png)");

    expect(refs).toEqual({ links: [], images: ["yes.png"] });
  });

  it("should ignore the title of a link", () => {
    expect(extractWikiReferences("[a](x.md \"titulo\") [b](y.md 't')").links).toEqual(["x.md", "y.md"]);
  });

  it("should read angle-bracket targets", () => {
    expect(extractWikiReferences("[a](<x.md>)").links).toEqual(["x.md"]);
  });

  it("should handle CRLF line endings around fences", () => {
    expect(extractWikiReferences("```\r\n[a](no.md)\r\n```\r\n[b](yes.md)").links).toEqual(["yes.md"]);
  });
});
