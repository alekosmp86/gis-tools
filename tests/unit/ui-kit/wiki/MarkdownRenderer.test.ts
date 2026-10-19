import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownRenderer } from "@/ui-kit/components/wiki/MarkdownRenderer";

function render(body: string, toolSlug = "mi-tool"): string {
  return renderToStaticMarkup(React.createElement(MarkdownRenderer, { body, toolSlug }));
}

describe("MarkdownRenderer", () => {
  describe("callouts", () => {
    it.each([
      ["NOTE", "Nota"],
      ["TIP", "Consejo"],
      ["WARNING", "Advertencia"],
    ])("should render a [!%s] blockquote as the %s callout with the marker stripped", (kind, label) => {
      const html = render(`> [!${kind}]\n> texto interno`);

      expect(html).toContain("<aside");
      expect(html).toContain(`<span>${label}</span>`);
      expect(html).toContain("texto interno");
      expect(html).not.toContain(`[!${kind}]`);
      expect(html).not.toContain("<blockquote");
    });

    it("should keep a plain quote as a blockquote", () => {
      const html = render("> cita");

      expect(html).toContain("<blockquote");
      expect(html).toContain("cita");
      expect(html).not.toContain("<aside");
    });

    it("should keep an unknown marker as a blockquote", () => {
      expect(render("> [!FOO]\n> x")).toContain("<blockquote");
    });

    it("should keep following paragraphs inside the callout", () => {
      const html = render("> [!NOTE]\n> uno\n>\n> dos");

      expect(html).toMatch(/<aside[\s\S]*uno[\s\S]*dos[\s\S]*<\/aside>/);
    });
  });

  describe("tables", () => {
    it("should wrap a GFM table in the scroll wrapper", () => {
      const html = render("| a | b |\n|---|---|\n| 1 | 2 |");

      expect(html).toMatch(/<div[^>]*><table>[\s\S]*<\/table><\/div>/);
      expect(html).toContain("<th>a</th>");
    });
  });

  describe("links", () => {
    it("should rewrite an internal link to the wiki route", () => {
      expect(render("[x](otra.md)")).toContain('href="/wiki/mi-tool/otra"');
    });

    it("should keep the anchor of an internal link", () => {
      expect(render("[x](otra.md#sec)")).toContain('href="/wiki/mi-tool/otra#sec"');
    });

    it("should open external links in a new tab with safe rel", () => {
      const html = render("[x](https://example.com)");

      expect(html).toContain('href="https://example.com"');
      expect(html).toContain('target="_blank"');
      expect(html).toContain('rel="noopener noreferrer"');
    });

    it("should not add target blank to internal links", () => {
      expect(render("[x](otra.md)")).not.toContain("_blank");
    });

    it("should leave an anchor-only link as is", () => {
      expect(render("[x](#sec)")).toContain('href="#sec"');
    });
  });

  describe("images", () => {
    it("should serve a relative image through the asset route", () => {
      const html = render("![texto alt](img/a.png)");

      expect(html).toContain("/api/wiki/assets/mi-tool/img/a.png");
      expect(html).toContain('alt="texto alt"');
    });

    it("should leave an https image source untouched", () => {
      expect(render("![a](https://x.com/a.png)")).toContain("https://x.com/a.png");
    });
  });

  describe("raw HTML", () => {
    it("should not render a script element", () => {
      const html = render("<script>alert(1)</script>\n\ntexto");

      expect(html).not.toContain("<script");
      expect(html).toContain("texto");
    });

    it("should not render inline html elements", () => {
      const html = render("antes <b>x</b> despues");

      expect(html).not.toContain("<b>");
    });
  });

  it("should render an empty body as an empty wrapper", () => {
    expect(render("")).toMatch(/^<div[^>]*><\/div>$/);
  });
});
