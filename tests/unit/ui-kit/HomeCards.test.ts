import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { Database } from "lucide-react";
import { describe, expect, it } from "vitest";
import { ToolCard } from "@/components/home/ToolCard";
import { toolsList } from "@/data/toolsData";
import { DedupHomeCard } from "@/modules/address-dedup/ui/DedupHomeCard";
import { WatcherHomeCard } from "@/modules/cartography-watcher/ui/WatcherHomeCard";
import { CoverageLoadsHomeCard } from "@/modules/coverage-loads/ui/CoverageLoadsHomeCard";
import { Header } from "@/ui-kit/components/layout/Header";
import { HomeCardFrame } from "@/ui-kit/components/HomeCardFrame";
import { BadgeVariant, type ToolCardData } from "@/ui-kit/types/ui";

function countOf(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

function expectSingleHelpLink(html: string, slug: string, label: string): void {
  expect(countOf(html, 'href="/wiki/')).toBe(1);
  expect(html).toContain(`href="/wiki/${slug}"`);
  expect(html).toContain(`aria-label="Ayuda: ${label}"`);
  expect(html).toContain('title="Ayuda"');
}

/** At the help link, no other anchor may be open: every `<a` before it has already been closed. */
function expectHelpLinkNotNested(html: string): void {
  const before = html.slice(0, html.indexOf('href="/wiki/'));
  const openedAnchors = countOf(before, "<a ") + countOf(before, "<a>");
  expect(countOf(before, "</a>")).toBe(openedAnchors - 1);
}

describe("HomeCardFrame", () => {
  it("should render the child and one help link as its sibling", () => {
    const child = React.createElement("a", { href: "/go" }, "card");

    const props = { wikiSlug: "x", wikiLabel: "Equis", children: child };

    const html = renderToStaticMarkup(React.createElement(HomeCardFrame, props));

    expectSingleHelpLink(html, "x", "Equis");
    expect(html).toContain('<a href="/go">card</a>');
    expectHelpLinkNotNested(html);
  });
});

describe("ToolCard", () => {
  it("should cover all five legacy tools", () => {
    expect(toolsList).toHaveLength(5);
  });

  it.each(toolsList.map((tool) => [tool.wikiSlug, tool] as const))(
    "should render one help link for legacy tool %s outside the button div",
    (slug, tool) => {
      const html = renderToStaticMarkup(React.createElement(ToolCard, { tool }));

      expectSingleHelpLink(html, slug, tool.title);
      expect(html).toContain('role="button"');
      const helpIndex = html.indexOf('<a ');
      const buttonDiv = html.slice(html.indexOf('<div role="button"'), helpIndex);
      expect(countOf(buttonDiv, "<div")).toBe(countOf(buttonDiv, "</div>"));
    },
  );

  it("should still show the help link on a disabled tool", () => {
    const tool: ToolCardData = {
      id: "off",
      title: "Apagada",
      category: [],
      badge: { label: "Pronto", type: BadgeVariant.ACTIVE },
      icon: Database,
      description: "d",
      tags: [],
      enabled: false,
      wikiSlug: "off-tool",
    };

    const html = renderToStaticMarkup(React.createElement(ToolCard, { tool }));

    expectSingleHelpLink(html, "off-tool", "Apagada");
    expect(html).not.toContain('role="button"');
  });
});

describe("module home cards", () => {
  it("should render CoverageLoadsHomeCard with a sibling help link", () => {
    const html = renderToStaticMarkup(React.createElement(CoverageLoadsHomeCard));

    expectSingleHelpLink(html, "coverage-loads", "Cargas de Coberturas");
    expectHelpLinkNotNested(html);
    expect(html).toContain('href="/tools/m/coverage-loads"');
  });

  it("should render DedupHomeCard with a sibling help link", () => {
    const html = renderToStaticMarkup(React.createElement(DedupHomeCard));

    expectSingleHelpLink(html, "address-dedup", "Duplicados de Direcciones");
    expectHelpLinkNotNested(html);
    expect(html).toContain('href="/tools/m/address-dedup"');
  });

  it("should render WatcherHomeCard with a sibling help link inside a QueryClientProvider", () => {
    const client = new QueryClient();
    const html = renderToStaticMarkup(
      React.createElement(QueryClientProvider, { client }, React.createElement(WatcherHomeCard)),
    );

    expectSingleHelpLink(html, "cartography-watcher", "Observador de Actualizaciones Cartográficas");
    expectHelpLinkNotNested(html);
    expect(html).toContain('href="/tools/m/cartography-watcher"');
  });
});

describe("Header", () => {
  it("should link to /wiki labelled Wiki", () => {
    const html = renderToStaticMarkup(React.createElement(Header));

    expect(html).toMatch(/<a [^>]*href="\/wiki"[^>]*>[\s\S]*<span>Wiki<\/span>[\s\S]*<\/a>/);
  });
});
