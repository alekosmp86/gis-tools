import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WatcherHomeCard } from "@/modules/cartography-watcher/ui/WatcherHomeCard";
import { expectHelpLinkNotNested, expectSingleHelpLink } from "../../ui-kit/helpLinkAssertions";

describe("WatcherHomeCard", () => {
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
