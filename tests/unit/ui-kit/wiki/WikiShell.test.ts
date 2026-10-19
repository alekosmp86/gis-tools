import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { WikiShell } from "@/ui-kit/components/wiki/WikiShell";

vi.mock("@/ui-kit/components/layout/Header", () => ({ Header: () => React.createElement("header") }));
vi.mock("@/ui-kit/components/layout/Footer", () => ({ Footer: () => React.createElement("footer") }));

describe("WikiShell", () => {
  const render = () =>
    renderToStaticMarkup(React.createElement(WikiShell, null, React.createElement("p", null, "contenido")));

  it("should render the back-to-top button so every wiki page gets it", () => {
    expect(render()).toContain('aria-label="Volver arriba"');
  });

  it("should render the back-to-top button after the footer and the children", () => {
    const out = render();

    expect(out.indexOf("contenido")).toBeLessThan(out.indexOf("</footer>"));
    expect(out.indexOf("</footer>")).toBeLessThan(out.indexOf("Volver arriba"));
  });
});
