import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readWikiAsset } from "@/core/wiki/readWikiAsset";
import { buildWikiAssetHeaders } from "@/core/wiki/wikiAssetHeaders";

const SVG_CSP = "default-src 'none'; style-src 'unsafe-inline'";

describe("buildWikiAssetHeaders", () => {
  it("should set type, cache and nosniff without a CSP for png", () => {
    const headers = buildWikiAssetHeaders("image/png");

    expect(headers).toEqual({
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
    });
    expect(headers).not.toHaveProperty("Content-Security-Policy");
  });

  it("should add the restrictive CSP for svg", () => {
    const headers = buildWikiAssetHeaders("image/svg+xml");

    expect(headers).toEqual({
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": SVG_CSP,
    });
  });

  it.each(["a.png", "a.jpg", "a.jpeg", "a.gif", "a.webp", "a.svg"])(
    "should set nosniff for the content type read for %s",
    async (name) => {
      const asset = await readWikiAsset("x", [name], async () => new Uint8Array([1]));

      const headers = buildWikiAssetHeaders(asset!.contentType);

      expect(headers["X-Content-Type-Options"]).toBe("nosniff");
      expect(headers["Content-Type"]).toBe(asset!.contentType);
    },
  );
});

describe("wiki asset serving pipeline with real files", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "wiki-asset-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("should read a real png and svg and build their headers", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    await writeFile(path.join(dir, "a.png"), png);
    await writeFile(path.join(dir, "b.svg"), "<svg xmlns='http://www.w3.org/2000/svg'/>");

    const pngAsset = await readWikiAsset(dir, ["a.png"], readFile);
    const svgAsset = await readWikiAsset(dir, ["b.svg"], readFile);

    expect(Array.from(pngAsset!.bytes)).toEqual(Array.from(png));
    expect(buildWikiAssetHeaders(pngAsset!.contentType)).not.toHaveProperty("Content-Security-Policy");
    expect(buildWikiAssetHeaders(svgAsset!.contentType)["Content-Security-Policy"]).toBe(SVG_CSP);
  });
});
