import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CoverageLoadsHomeCard } from "@/modules/coverage-loads/ui/CoverageLoadsHomeCard";
import { expectHelpLinkNotNested, expectSingleHelpLink } from "../../ui-kit/helpLinkAssertions";

describe("CoverageLoadsHomeCard", () => {
  it("should render CoverageLoadsHomeCard with a sibling help link", () => {
    const html = renderToStaticMarkup(React.createElement(CoverageLoadsHomeCard));

    expectSingleHelpLink(html, "coverage-loads", "Cargas de Coberturas");
    expectHelpLinkNotNested(html);
    expect(html).toContain('href="/tools/m/coverage-loads"');
  });
});
