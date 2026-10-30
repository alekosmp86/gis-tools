import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TableSelectorProps } from "@/ui-kit/components/TableSelector";
import { UnidadTablesStep } from "@/modules/routine-jobs/ui/steps/UnidadTablesStep";
import { UnitSlot } from "@/modules/routine-jobs/ui/unidadTerritorialWizardState";
import { UNIT_REQUIRED_COLUMNS_BY_ROLE, UNIT_TABLE_ROLE } from "@/modules/routine-jobs/jobs/unidad-territorial/constants";

const captured = vi.hoisted(() => ({ selectors: [] as unknown[] }));

vi.mock("@/ui-kit/components/TableSelector", () => ({
  TableSelector: (props: unknown) => {
    captured.selectors.push(props);
    return null;
  },
}));

type Props = React.ComponentProps<typeof UnidadTablesStep>;

const LABELS = {
  locality: "Tabla de localidades catastrales (origen)",
  target: "Tabla de unidades territoriales (destino)",
  type: "Tabla de tipos de unidad territorial",
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
      [UnitSlot.LOCALITY]: { schema: "stg", table: "localidades_catastrales_stg" },
      [UnitSlot.TARGET]: { schema: "carto", table: "territorial_unit" },
      [UnitSlot.TYPE]: { schema: "carto", table: "tipo_unidad" },
      [UnitSlot.ADDRESS_MASTER]: { schema: "carto", table: "addresses_master" },
    },
    excluded: { [UnitSlot.LOCALITY]: [], [UnitSlot.TARGET]: ["x"], [UnitSlot.TYPE]: [], [UnitSlot.ADDRESS_MASTER]: [] },
    linkAddressMaster: false,
    onLinkAddressMasterChange: vi.fn(),
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
  return renderToStaticMarkup(React.createElement(UnidadTablesStep, propsOf(overrides)));
}

describe("UnidadTablesStep wiring (stage 3 after the shared slot step extraction)", () => {
  beforeEach(() => {
    captured.selectors.length = 0;
  });

  it("should render exactly three table selectors, locality, target and type", () => {
    render();

    expect(selectors()).toHaveLength(3);
    for (const label of Object.values(LABELS)) {
      expect(selectorLabelled(label).label).toBe(label);
    }
  });

  it("should list each table in its own chosen schema", () => {
    render();

    expect(selectorLabelled(LABELS.locality).schema).toBe("stg");
    expect(selectorLabelled(LABELS.target).schema).toBe("carto");
    expect(selectorLabelled(LABELS.type).schema).toBe("carto");
  });

  it("should check the columns of each table with the role of its slot", () => {
    const checkColumns = vi.fn().mockResolvedValue([]);
    render({ checkColumns });

    void selectorLabelled(LABELS.locality).checkColumns("localidades");
    void selectorLabelled(LABELS.target).checkColumns("unidades");
    void selectorLabelled(LABELS.type).checkColumns("tipos");

    expect(checkColumns).toHaveBeenNthCalledWith(1, UNIT_TABLE_ROLE.SOURCE, "stg", "localidades");
    expect(checkColumns).toHaveBeenNthCalledWith(2, UNIT_TABLE_ROLE.TARGET, "carto", "unidades");
    expect(checkColumns).toHaveBeenNthCalledWith(3, UNIT_TABLE_ROLE.TYPE, "carto", "tipos");
  });

  it("should check the target with the linked role, which requires id_address_master, when the link is on", () => {
    const checkColumns = vi.fn().mockResolvedValue([]);
    render({ checkColumns, linkAddressMaster: true });

    void selectorLabelled(LABELS.target).checkColumns("unidades");

    expect(checkColumns).toHaveBeenCalledWith(UNIT_TABLE_ROLE.TARGET_LINKED, "carto", "unidades");
    expect(UNIT_REQUIRED_COLUMNS_BY_ROLE[UNIT_TABLE_ROLE.TARGET_LINKED]).toContain("id_address_master");
  });

  it("should report a choice with the slot key it belongs to", () => {
    const onTableChange = vi.fn();
    render({ onTableChange });

    selectorLabelled(LABELS.target).onChange("otra_unidad");

    expect(onTableChange).toHaveBeenCalledWith(UnitSlot.TARGET, "otra_unidad", false);
  });

  it("should pass the excluded names of each slot to its selector", () => {
    render();

    expect(selectorLabelled(LABELS.target).excludedTables).toEqual(["x"]);
    expect(selectorLabelled(LABELS.locality).excludedTables).toEqual([]);
  });

  it("should disable a selector while its schema is blank", () => {
    render({ slots: { ...propsOf().slots, [UnitSlot.TYPE]: { schema: "", table: "" } } });

    expect(selectorLabelled(LABELS.type).disabled).toBe(true);
    expect(selectorLabelled(LABELS.target).disabled).toBe(false);
  });

  it("should show the catalog error in an alert region and the blocking reason as a warning", () => {
    const html = render({ catalogError: "Servidor no disponible.", blockingReason: "Las tablas deben ser distintas." });

    expect(html).toContain('role="alert"');
    expect(html).toContain("Servidor no disponible.");
    expect(html).toContain("Las tablas deben ser distintas.");
  });
});
