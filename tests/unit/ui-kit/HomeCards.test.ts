import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Database } from "lucide-react";
import { describe, expect, it } from "vitest";
import { ToolCard } from "@/components/home/ToolCard";
import { toolsList } from "@/data/toolsData";
import { Header } from "@/ui-kit/components/layout/Header";
import { HomeCardFrame } from "@/ui-kit/components/HomeCardFrame";
import { BadgeVariant, type ToolCardData } from "@/ui-kit/types/ui";
import { countOccurrences, expectHelpLinkNotNested, expectSingleHelpLink } from "./helpLinkAssertions";

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
      expect(countOccurrences(buttonDiv, "<div")).toBe(countOccurrences(buttonDiv, "</div>"));
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

describe("Header", () => {
  it("should link to /wiki labelled Wiki", () => {
    const html = renderToStaticMarkup(React.createElement(Header));

    expect(html).toMatch(/<a [^>]*href="\/wiki"[^>]*>[\s\S]*<span>Wiki<\/span>[\s\S]*<\/a>/);
  });
});
