import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TableSelectorProps } from "@/ui-kit/components/TableSelector";
import { TablesStep } from "@/modules/routine-jobs/ui/steps/TablesStep";

const captured = vi.hoisted(() => ({ selectors: [] as unknown[] }));

vi.mock("@/ui-kit/components/TableSelector", () => ({
  TableSelector: (props: unknown) => {
    captured.selectors.push(props);
    return null;
  },
}));

type Props = React.ComponentProps<typeof TablesStep>;

const selectors = (): TableSelectorProps[] => captured.selectors as TableSelectorProps[];
const selectorLabelled = (label: string): TableSelectorProps => {
  const found = selectors().find((props) => props.label === label);
  if (!found) throw new Error(`No TableSelector labelled ${label}`);
  return found;
};

function render(overrides: Partial<Props> = {}): Props {
  const props: Props = {
    schema: "catastro",
    committedSchema: "catastro",
    tables: { rural: "r1", urbano: "u1", target: "t1" },
    excluded: { rural: ["u1", "t1"], urbano: ["r1", "t1"], target: ["r1", "u1"] },
    onSchemaCommit: vi.fn(),
    onTableChange: vi.fn(),
    loadTables: vi.fn().mockResolvedValue({ schemaExists: true, tables: [] }),
    checkColumns: vi.fn().mockResolvedValue([]),
    blockingReason: null,
    catalogError: null,
    ...overrides,
  };
  renderToStaticMarkup(React.createElement(TablesStep, props));
  return props;
}

describe("TablesStep wiring", () => {
  beforeEach(() => {
    captured.selectors.length = 0;
  });

  it("AC-32: should render three selectors labelled rural, urbana and destino", () => {
    render();

    expect(selectors().map((props) => props.label).sort()).toEqual(["Tabla destino", "Tabla rural", "Tabla urbana"]);
  });

  it("AC-32: should pass the schema and each role's chosen table to its selector", () => {
    render();

    expect(selectorLabelled("Tabla rural")).toMatchObject({ schema: "catastro", value: "r1" });
    expect(selectorLabelled("Tabla urbana")).toMatchObject({ schema: "catastro", value: "u1" });
    expect(selectorLabelled("Tabla destino")).toMatchObject({ schema: "catastro", value: "t1" });
  });

  it("AC-32: should pass the committed schema, not a draft, to the selectors", () => {
    render({ schema: "borrador", committedSchema: "confirmado" });

    for (const props of selectors()) expect(props.schema).toBe("confirmado");
  });

  it("AC-32: should pass each role its own excluded tables", () => {
    render();

    expect(selectorLabelled("Tabla rural").excludedTables).toEqual(["u1", "t1"]);
    expect(selectorLabelled("Tabla urbana").excludedTables).toEqual(["r1", "t1"]);
    expect(selectorLabelled("Tabla destino").excludedTables).toEqual(["r1", "u1"]);
  });

  it("AC-32: should hand the table listing function through to every selector", async () => {
    const loadTables = vi.fn().mockResolvedValue({ schemaExists: true, tables: [] });
    render({ loadTables });

    for (const props of selectors()) await props.loadTables("otro");

    expect(loadTables).toHaveBeenCalledTimes(3);
    expect(loadTables).toHaveBeenCalledWith("otro");
  });

  it("AC-32: should check the columns of a table with the role of the selector that asked", async () => {
    const checkColumns = vi.fn().mockResolvedValue([]);
    render({ checkColumns });

    await selectorLabelled("Tabla rural").checkColumns("r1");
    await selectorLabelled("Tabla urbana").checkColumns("u1");
    await selectorLabelled("Tabla destino").checkColumns("t1");

    expect(checkColumns).toHaveBeenNthCalledWith(1, "rural", "r1");
    expect(checkColumns).toHaveBeenNthCalledWith(2, "urbano", "u1");
    expect(checkColumns).toHaveBeenNthCalledWith(3, "target", "t1");
  });

  it("AC-32: should report a newly chosen table for the role as not valid until its columns are checked", () => {
    const props = render();

    selectorLabelled("Tabla urbana").onChange("nueva");

    expect(props.onTableChange).toHaveBeenCalledWith("urbano", "nueva", false);
  });

  it("AC-32: should report the validity of the current table for the role once its columns are checked", () => {
    const props = render();

    selectorLabelled("Tabla destino").onValidityChange?.(true, []);

    expect(props.onTableChange).toHaveBeenLastCalledWith("target", "t1", true);
  });

  it("AC-32: should report an invalid table as not valid", () => {
    const props = render();

    selectorLabelled("Tabla rural").onValidityChange?.(false, []);

    expect(props.onTableChange).toHaveBeenLastCalledWith("rural", "r1", false);
  });

  it("AC-3b: should hide the list error on all three selectors when the catalog error is set", () => {
    render({ catalogError: "Error interno al procesar la solicitud." });

    expect(selectors()).toHaveLength(3);
    for (const props of selectors()) expect(props.hideListError).toBe(true);
  });

  it("AC-3b: should not hide the list error on any selector when the catalog error is null", () => {
    render({ catalogError: null });

    expect(selectors()).toHaveLength(3);
    for (const props of selectors()) expect(props.hideListError).toBeFalsy();
  });

  it("AC-32: should pass no excluded tables when nothing else is chosen", () => {
    render({ excluded: { rural: [], urbano: [], target: [] }, tables: { rural: "", urbano: "", target: "" } });

    for (const props of selectors()) expect(props.excludedTables ?? []).toEqual([]);
  });
});
