import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DedupHomeCard } from "@/modules/address-dedup/ui/DedupHomeCard";
import { expectHelpLinkNotNested, expectSingleHelpLink } from "../../ui-kit/helpLinkAssertions";

describe("DedupHomeCard", () => {
  it("should render DedupHomeCard with a sibling help link", () => {
    const html = renderToStaticMarkup(React.createElement(DedupHomeCard));

    expectSingleHelpLink(html, "address-dedup", "Duplicados de Direcciones");
    expectHelpLinkNotNested(html);
    expect(html).toContain('href="/tools/m/address-dedup"');
  });
});
