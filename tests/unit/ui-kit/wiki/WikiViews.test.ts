import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { WikiBreadcrumbs } from "@/ui-kit/components/wiki/WikiBreadcrumbs";
import { WikiEmptyState } from "@/ui-kit/components/wiki/WikiEmptyState";
import { WikiPageView } from "@/ui-kit/components/wiki/WikiPageView";
import { WikiSidebar } from "@/ui-kit/components/wiki/WikiSidebar";
import { WikiToolCard } from "@/ui-kit/components/wiki/WikiToolCard";

const PAGES = [
  { slug: "uno", title: "Primera" },
  { slug: "dos", title: "Segunda" },
  { slug: "tres", title: "Tercera" },
];

function html(element: React.ReactElement): string {
  return renderToStaticMarkup(element);
}

describe("WikiSidebar", () => {
  const render = (currentPageSlug: string | null) =>
    html(React.createElement(WikiSidebar, { toolSlug: "t", toolTitle: "Tool", pages: PAGES, currentPageSlug }));

  it("should list pages in the given order with wiki hrefs", () => {
    const out = render("uno");

    expect(out.indexOf("Primera")).toBeLessThan(out.indexOf("Segunda"));
    expect(out.indexOf("Segunda")).toBeLessThan(out.indexOf("Tercera"));
    expect(out).toContain('href="/wiki/t/dos"');
  });

  it("should mark only the current page", () => {
    const out = render("dos");

    expect(out.match(/aria-current="page"/g)).toHaveLength(1);
    expect(out).toMatch(/aria-current="page"[^>]*>Segunda</);
  });

  it("should mark nothing when there is no current page", () => {
    expect(render(null)).not.toContain("aria-current");
  });

  it("should render no items for an empty page list", () => {
    const out = html(
      React.createElement(WikiSidebar, { toolSlug: "t", toolTitle: "Tool", pages: [], currentPageSlug: null }),
    );

    expect(out).not.toContain("<li");
  });
});

describe("WikiBreadcrumbs", () => {
  it("should link ancestors and mark the last item as current", () => {
    const out = html(
      React.createElement(WikiBreadcrumbs, {
        items: [{ label: "Wiki", href: "/wiki" }, { label: "Tool", href: "/wiki/t" }, { label: "Pagina" }],
      }),
    );

    expect(out).toContain('href="/wiki"');
    expect(out).toContain('href="/wiki/t"');
    expect(out).toMatch(/aria-current="page"[^>]*>Pagina</);
    expect(out.indexOf("Wiki")).toBeLessThan(out.indexOf("Tool"));
    expect(out.indexOf("Tool")).toBeLessThan(out.indexOf("Pagina"));
  });
});

describe("WikiBreadcrumbs keys", () => {
  it("should render a trail with a current crumb without duplicate key warnings", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const out = html(
      React.createElement(WikiBreadcrumbs, { items: [{ label: "Wiki", href: "/wiki" }, { label: "Tool" }] }),
    );

    const keyWarnings = errorSpy.mock.calls.filter((call) => String(call[0]).includes("same key"));
    errorSpy.mockRestore();
    expect(keyWarnings).toHaveLength(0);
    expect(out).toContain('href="/wiki"');
    expect(out).toMatch(/aria-current="page"[^>]*>Tool</);
  });
});

describe("WikiEmptyState", () => {
  it("should show En construcción and the tool title", () => {
    const out = html(React.createElement(WikiEmptyState, { toolTitle: "Mi Tool" }));

    expect(out).toContain("En construcción");
    expect(out).toContain("Mi Tool");
  });
});

describe("WikiPageView", () => {
  it("should render trail Wiki > tool > page, sidebar and body for a page", () => {
    const out = html(
      React.createElement(WikiPageView, {
        toolSlug: "t",
        toolTitle: "Tool",
        pages: PAGES,
        currentPage: { slug: "dos", title: "Segunda", body: "# Hola\n\ncuerpo" },
      }),
    );

    expect(out).toContain('href="/wiki"');
    expect(out).toContain('href="/wiki/t"');
    expect(out).toContain("<h1>Hola</h1>");
    expect(out).toContain('aria-label="Páginas de Tool"');
    expect(out).not.toContain("En construcción");
  });

  it("should end the trail at the tool as a non-link when the page title equals the tool title", () => {
    const out = html(
      React.createElement(WikiPageView, {
        toolSlug: "t",
        toolTitle: "Tool",
        pages: PAGES,
        currentPage: { slug: "uno", title: "Tool", body: "cuerpo" },
      }),
    );
    const nav = out.slice(out.indexOf("<nav"), out.indexOf("</nav>"));

    expect(nav).toContain('href="/wiki"');
    expect(nav).not.toContain('href="/wiki/t"');
    expect(nav).toMatch(/aria-current="page"[^>]*>Tool</);
    expect(nav.match(/<span/g)).toHaveLength(1);
  });

  it("should link the tool and show the page as current when titles differ", () => {
    const out = html(
      React.createElement(WikiPageView, {
        toolSlug: "t",
        toolTitle: "Tool",
        pages: PAGES,
        currentPage: { slug: "dos", title: "Segunda", body: "cuerpo" },
      }),
    );
    const nav = out.slice(out.indexOf("<nav"), out.indexOf("</nav>"));

    expect(nav).toContain('href="/wiki/t"');
    expect(nav).toMatch(/aria-current="page"[^>]*>Segunda</);
  });

  it("should render the empty state when currentPage is null", () => {
    const out = html(
      React.createElement(WikiPageView, { toolSlug: "t", toolTitle: "Tool", pages: [], currentPage: null }),
    );

    expect(out).toContain("En construcción");
    expect(out).not.toContain("<article");
    expect(out).not.toContain("Páginas de");
  });
});

describe("WikiToolCard", () => {
  const render = (pageCount: number) =>
    html(React.createElement(WikiToolCard, { toolSlug: "t", title: "Tool", pageCount }));

  it("should link to the tool wiki", () => {
    expect(render(2)).toContain('href="/wiki/t"');
  });

  it.each([
    [0, "En construcción"],
    [1, ">1 página<"],
    [3, "3 páginas"],
  ])("should describe %i pages as %s", (count, text) => {
    expect(render(count)).toContain(text);
  });
});
