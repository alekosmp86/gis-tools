import React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TableSelector } from "@/ui-kit/components/TableSelector";
import type { ResolvedColumn, TableListing } from "@/core/types/tableCatalog";

type Props = React.ComponentProps<typeof TableSelector>;

const SOURCE_PATH = resolve(process.cwd(), "src/ui-kit/components/TableSelector.tsx");

function render(overrides: Partial<Props> = {}): string {
  const props: Props = {
    label: "Tabla rural",
    schema: "carto",
    value: "",
    onChange: () => undefined,
    loadTables: async (): Promise<TableListing> => ({ schemaExists: true, tables: [] }),
    checkColumns: async (): Promise<ResolvedColumn[]> => [],
    ...overrides,
  };
  return renderToStaticMarkup(React.createElement(TableSelector, props));
}

describe("TableSelector (static markup)", () => {
  it("AC-3b: should render the label text", () => {
    const html = render({ label: "Tabla urbana" });

    expect(html).toContain("Tabla urbana");
    expect(html).toContain("<label");
  });

  it("AC-3b: should render a select control", () => {
    const html = render();

    expect(html).toContain("<select");
  });

  it("AC-3b: should show the selected value in the initial markup", () => {
    const html = render({ value: "padron_rural_2024" });

    expect(html).toContain("padron_rural_2024");
  });

  it("AC-3b: should render without throwing for an empty value and an empty schema", () => {
    expect(() => render({ value: "", schema: "" })).not.toThrow();
  });

  it("AC-3b: should disable the select when disabled is true", () => {
    const html = render({ disabled: true });

    expect(html).toMatch(/<select[^>]*\sdisabled/);
  });

  it("AC-3b: should leave the select enabled by default", () => {
    const html = render();

    expect(html).not.toMatch(/<select[^>]*\sdisabled/);
  });

  it("AC-3b: should not call the loaders or callbacks during the initial render", () => {
    const loadTables = vi.fn(async (): Promise<TableListing> => ({ schemaExists: true, tables: [] }));
    const checkColumns = vi.fn(async (): Promise<ResolvedColumn[]> => []);
    const onChange = vi.fn();
    const onValidityChange = vi.fn();

    render({ loadTables, checkColumns, onChange, onValidityChange, value: "x", excludedTables: ["y"] });

    expect(onChange).not.toHaveBeenCalled();
    expect(onValidityChange).not.toHaveBeenCalled();
    expect(checkColumns).not.toHaveBeenCalled();
  });

  it("AC-3b: should not emit inline style attributes", () => {
    const html = render({ value: "padron", disabled: true, excludedTables: ["a"] });

    expect(html).not.toContain("style=");
  });

  it("AC-3b: should still render the select and label when hideListError is true", () => {
    const html = render({ label: "Tabla destino", hideListError: true });

    expect(html).toContain("Tabla destino");
    expect(html).toContain("<select");
  });

  it("AC-3b: should not expose hideListError as a DOM attribute", () => {
    const html = render({ value: "padron", hideListError: true });

    expect(html.toLowerCase()).not.toContain("hidelisterror");
  });

  it("AC-3b: should render the same markup whether hideListError is true or omitted", () => {
    expect(render({ value: "padron", hideListError: true })).toBe(render({ value: "padron" }));
  });
});

describe("TableSelector (source conventions)", () => {
  const source = readFileSync(SOURCE_PATH, "utf8");

  it("AC-3b: should import only from core, ui-kit, react or relative files", () => {
    const specifiers = Array.from(source.matchAll(/from\s+["']([^"']+)["']/g), (match) => match[1]);

    expect(specifiers.length).toBeGreaterThan(0);
    for (const specifier of specifiers) {
      const allowed =
        specifier === "react" ||
        specifier.startsWith("./") ||
        specifier.startsWith("@/core/") ||
        specifier.startsWith("@/ui-kit/");
      expect(allowed, `unexpected import "${specifier}"`).toBe(true);
    }
  });

  it("AC-3b: should not import from server-only code or from a module", () => {
    expect(source).not.toMatch(/from\s+["']@\/core\/services\/server\//);
    expect(source).not.toMatch(/from\s+["']@\/modules\//);
  });

  it("AC-3b: should use a CSS module and no inline style prop", () => {
    expect(source).toContain("TableSelector.module.css");
    expect(source).not.toMatch(/style=\{/);
  });

  it("AC-3b: should render the same markup with an onLoadError callback", () => {
    const withCallback = render({ value: "padron", onLoadError: () => undefined });

    expect(withCallback).toBe(render({ value: "padron" }));
  });

  it("AC-3b: should declare hideListError as an optional boolean prop", () => {
    expect(source).toMatch(/hideListError\?:\s*boolean/);
  });

  it("AC-3b: should decide the list error box with shouldShowListError", () => {
    expect(source).toContain("shouldShowListError(");
  });

  it("AC-3b: should not call onLoadError while rendering statically", () => {
    const onLoadError = vi.fn();

    render({ onLoadError });

    expect(onLoadError).not.toHaveBeenCalled();
  });
});
