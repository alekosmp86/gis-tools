import React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TablesStep } from "@/modules/routine-jobs/ui/steps/TablesStep";

type Props = React.ComponentProps<typeof TablesStep>;

function render(overrides: Partial<Props> = {}): string {
  const props: Props = {
    schema: "catastro",
    committedSchema: "catastro",
    tables: { rural: "", urbano: "", target: "" },
    excluded: { rural: [], urbano: [], target: [] },
    onSchemaCommit: vi.fn(),
    onTableChange: vi.fn(),
    loadTables: vi.fn().mockResolvedValue({ schemaExists: true, tables: [] }),
    checkColumns: vi.fn().mockResolvedValue([]),
    blockingReason: null,
    catalogError: null,
    ...overrides,
  };
  return renderToStaticMarkup(React.createElement(TablesStep, props));
}

describe("TablesStep", () => {
  it("AC-32: should render the schema field with its current value", () => {
    const html = render({ schema: "mi_esquema", committedSchema: "mi_esquema" });

    expect(html).toContain("Esquema");
    expect(html).toContain('value="mi_esquema"');
  });

  it("AC-32: should render the three table selectors with their Spanish labels", () => {
    const html = render();

    expect(html).toContain("Tabla rural");
    expect(html).toContain("Tabla urbana");
    expect(html).toContain("Tabla destino");
  });

  it("AC-32: should render exactly one table selector per role", () => {
    const html = render();

    expect(html.split("<select").length - 1).toBe(3);
  });

  it("AC-32: should keep the chosen tables visible in their selectors", () => {
    const html = render({ tables: { rural: "padron_rural", urbano: "padron_urbano", target: "padron" } });

    expect(html).toContain('value="padron_rural"');
    expect(html).toContain('value="padron_urbano"');
    expect(html).toContain('value="padron"');
  });

  it("AC-32: should show the blocking reason when there is one", () => {
    const html = render({ blockingReason: "Elija las tres tablas: rural, urbana y destino." });

    expect(html).toContain("Elija las tres tablas: rural, urbana y destino.");
  });

  it("AC-32: should show no blocking text when the reason is null", () => {
    const html = render({ blockingReason: null });

    expect(html).not.toContain("Elija las tres tablas");
  });

  it("AC-32: should render with an empty schema", () => {
    const html = render({ schema: "", committedSchema: "" });

    expect(html).toContain("Tabla destino");
  });

  it("AC-32: should not call the backend while rendering statically", () => {
    const loadTables = vi.fn().mockResolvedValue({ schemaExists: true, tables: [] });
    const checkColumns = vi.fn().mockResolvedValue([]);

    render({ loadTables, checkColumns, tables: { rural: "a", urbano: "b", target: "c" } });

    expect(loadTables).not.toHaveBeenCalled();
    expect(checkColumns).not.toHaveBeenCalled();
  });

  it("AC-32: should keep the committed schema in the Esquema field on the initial render", () => {
    const html = render({ schema: "committed_s", committedSchema: "committed_s" });

    expect(html).toContain("Esquema");
    expect(html).toContain('value="committed_s"');
  });

  it("AC-32: should not commit the schema while rendering", () => {
    const onSchemaCommit = vi.fn();

    render({ onSchemaCommit });

    expect(onSchemaCommit).not.toHaveBeenCalled();
  });

  it("AC-32: should not expose a per-keystroke onSchemaChange prop any more", () => {
    const source = readFileSync(resolve(process.cwd(), "src/modules/routine-jobs/ui/steps/TablesStep.tsx"), "utf8");

    expect(source).not.toContain("onSchemaChange");
    expect(source).toContain("onSchemaCommit");
  });

  describe("catalogError", () => {
    const MESSAGE = "No se pudo consultar la base. Revise servidor, puerto, usuario y contraseña en el paso 1.";
    const SERVER_MESSAGE = "Error interno al procesar la solicitud.";

    it("AC-32: should render one alert with the fixed text and the server message when set", () => {
      const html = render({ catalogError: SERVER_MESSAGE, blockingReason: null });

      expect(html.split('role="alert"').length - 1).toBe(1);
      expect(html).toContain(MESSAGE);
      expect(html).toContain(SERVER_MESSAGE);
    });

    it("AC-32: should show the catalog message exactly once, not once per selector", () => {
      const html = render({ catalogError: "ECONNREFUSED", blockingReason: null });

      expect(html.split("No se pudo consultar la base").length - 1).toBe(1);
      expect(html.split("ECONNREFUSED").length - 1).toBe(1);
    });

    it("AC-32: should render no catalog alert when the error is null", () => {
      const html = render({ catalogError: null, blockingReason: null });

      expect(html).not.toContain("No se pudo consultar la base");
      expect(html).not.toContain('role="alert"');
    });
  });

  it("AC-32: should not use inline styles", () => {
    const html = render({ blockingReason: "x", tables: { rural: "a", urbano: "b", target: "c" } });

    expect(html).not.toMatch(/\sstyle=/);
  });
});
