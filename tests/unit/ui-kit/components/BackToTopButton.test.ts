import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BackToTopButton } from "@/ui-kit/components/BackToTopButton";

describe("BackToTopButton", () => {
  const render = () => renderToStaticMarkup(React.createElement(BackToTopButton));

  it("should server-render a labelled button of type button", () => {
    const out = render();

    expect(out).toMatch(/^<button /);
    expect(out).toContain('type="button"');
    expect(out).toContain('aria-label="Volver arriba"');
    expect(out).toContain('title="Volver arriba"');
  });

  it("should server-render the hidden state removed from tab order and a11y tree", () => {
    const out = render();

    expect(out).toContain('aria-hidden="true"');
    expect(out).toContain('tabindex="-1"');
  });

  it("should not apply the visible class on the initial render", () => {
    const classAttr = /class="([^"]*)"/.exec(render())?.[1] ?? "";
    const classes = classAttr.split(/\s+/);

    expect(classes.some((c) => /visible/.test(c))).toBe(false);
    expect(classes.length).toBeGreaterThan(0);
  });

  it("should render an svg arrow icon", () => {
    expect(render()).toContain("<svg");
  });
});
