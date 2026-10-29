import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TableSelectorProps } from "@/ui-kit/components/TableSelector";
import { CompletarTablesStep } from "@/modules/routine-jobs/ui/steps/CompletarTablesStep";
import { CompletarSlot } from "@/modules/routine-jobs/ui/completarUnidadTerritorialWizardState";
import { COMPLETAR_TABLE_ROLE } from "@/modules/routine-jobs/jobs/completar-unidad-territorial/constants";

const captured = vi.hoisted(() => ({ selectors: [] as unknown[] }));

vi.mock("@/ui-kit/components/TableSelector", () => ({
  TableSelector: (props: unknown) => {
    captured.selectors.push(props);
    return null;
  },
}));

type Props = React.ComponentProps<typeof CompletarTablesStep>;

const LABELS = {
  unit: "Tabla de unidades territoriales",
  addressMaster: "Tabla de direcciones maestras",
} as const;

const selectors = (): TableSelectorProps[] => captured.selectors as TableSelectorProps[];
const selectorLabelled = (label: string): TableSelectorProps => {
  const found = selectors().find((props) => props.label === label);
  if (!found) throw new Error(`No TableSelector labelled ${label}`);
  return found;
};

function propsOf(overrides: Partial<Props> = {}): Props {
  return {
    slots: {
      [CompletarSlot.UNIT]: { schema: "carto", table: "territorial_unit" },
      [CompletarSlot.ADDRESS_MASTER]: { schema: "carto_cat", table: "addresses_master" },
    },
    excluded: { [CompletarSlot.UNIT]: ["x"], [CompletarSlot.ADDRESS_MASTER]: [] },
    onSchemaChange: vi.fn(),
    onTableChange: vi.fn(),
    loadTables: vi.fn().mockResolvedValue({ schemaExists: true, tables: [] }),
    checkColumns: vi.fn().mockResolvedValue([]),
    blockingReason: null,
    catalogError: null,
    ...overrides,
  };
}

function render(overrides: Partial<Props> = {}): string {
  return renderToStaticMarkup(React.createElement(CompletarTablesStep, propsOf(overrides)));
}

describe("CompletarTablesStep wiring", () => {
  beforeEach(() => {
    captured.selectors.length = 0;
  });

  it("should render exactly two table selectors, one for the unit and one for the address master tables", () => {
    render();

    expect(selectors()).toHaveLength(2);
    expect(selectorLabelled(LABELS.unit)).toBeDefined();
    expect(selectorLabelled(LABELS.addressMaster)).toBeDefined();
  });

  it("should list each table in its own schema", () => {
    render();

    expect(selectorLabelled(LABELS.unit).schema).toBe("carto");
    expect(selectorLabelled(LABELS.addressMaster).schema).toBe("carto_cat");
  });

  it("should show each table with its chosen value", () => {
    render();

    expect(selectorLabelled(LABELS.unit).value).toBe("territorial_unit");
    expect(selectorLabelled(LABELS.addressMaster).value).toBe("addresses_master");
  });

  it("should pass the excluded names of each slot to its selector", () => {
    render();

    expect(selectorLabelled(LABELS.unit).excludedTables).toEqual(["x"]);
    expect(selectorLabelled(LABELS.addressMaster).excludedTables).toEqual([]);
  });

  it("should report a choice with the key of its slot", () => {
    const onTableChange = vi.fn();
    render({ onTableChange });

    selectorLabelled(LABELS.addressMaster).onChange("otra_tabla");

    expect(onTableChange).toHaveBeenCalledWith(CompletarSlot.ADDRESS_MASTER, "otra_tabla", false);
  });

  it("should report a validity change with the table currently chosen in its slot", () => {
    const onTableChange = vi.fn();
    render({ onTableChange });

    selectorLabelled(LABELS.unit).onValidityChange?.(true, []);

    expect(onTableChange).toHaveBeenCalledWith(CompletarSlot.UNIT, "territorial_unit", true);
  });

  it("should check the columns of the unit table with the unit role and the trimmed schema", () => {
    const checkColumns = vi.fn().mockResolvedValue([]);
    render({ checkColumns, slots: { ...propsOf().slots, [CompletarSlot.UNIT]: { schema: " carto ", table: "territorial_unit" } } });

    void selectorLabelled(LABELS.unit).checkColumns("territorial_unit");

    expect(checkColumns).toHaveBeenCalledWith(COMPLETAR_TABLE_ROLE.UNIT, "carto", "territorial_unit");
  });

  it("should check the columns of the address master table with the address master role", () => {
    const checkColumns = vi.fn().mockResolvedValue([]);
    render({ checkColumns });

    void selectorLabelled(LABELS.addressMaster).checkColumns("addresses_master");

    expect(checkColumns).toHaveBeenCalledWith(COMPLETAR_TABLE_ROLE.ADDRESS_MASTER, "carto_cat", "addresses_master");
  });

  it("should disable a selector while its schema is blank and enable the other one", () => {
    render({ slots: { ...propsOf().slots, [CompletarSlot.UNIT]: { schema: "  ", table: "" } } });

    expect(selectorLabelled(LABELS.unit).disabled).toBe(true);
    expect(selectorLabelled(LABELS.addressMaster).disabled).toBe(false);
  });

  it("should hide the list error of each selector while a catalog error is shown", () => {
    render({ catalogError: "Servidor no disponible." });

    expect(selectors().every((props) => props.hideListError)).toBe(true);
  });

  it("should show the catalog error inside an alert region", () => {
    const html = render({ catalogError: "Servidor no disponible." });

    expect(html).toContain('role="alert"');
    expect(html).toContain("Servidor no disponible.");
  });

  it("should show the blocking reason when there is one", () => {
    expect(render({ blockingReason: "Las tablas elegidas deben ser distintas." })).toContain("Las tablas elegidas deben ser distintas.");
  });

  it("should use no inline styles", () => {
    expect(render()).not.toMatch(/\sstyle=/);
  });
});
