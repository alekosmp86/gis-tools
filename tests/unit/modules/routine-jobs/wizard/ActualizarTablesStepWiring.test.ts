import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TableSelectorProps } from "@/ui-kit/components/TableSelector";
import { ActualizarTablesStep } from "@/modules/routine-jobs/ui/steps/ActualizarTablesStep";
import { ActualizarTableKey } from "@/modules/routine-jobs/ui/actualizarPadronWizardState";

const captured = vi.hoisted(() => ({ selectors: [] as unknown[] }));

vi.mock("@/ui-kit/components/TableSelector", () => ({
  TableSelector: (props: unknown) => {
    captured.selectors.push(props);
    return null;
  },
}));

type Props = React.ComponentProps<typeof ActualizarTablesStep>;

const selectors = (): TableSelectorProps[] => captured.selectors as TableSelectorProps[];
const selectorLabelled = (label: string): TableSelectorProps => {
  const found = selectors().find((props) => props.label === label);
  if (!found) throw new Error(`No TableSelector labelled ${label}`);
  return found;
};

const LABELS = {
  staging: "Tabla de origen",
  work: "Tabla de trabajo",
  padron: "Tabla padrón",
  province: "Tabla de provincias",
  locality: "Tabla de localidades",
} as const;

function render(overrides: Partial<Props> = {}): void {
  const props: Props = {
    stagingSchema: "bdj_carto",
    workSchema: "carto",
    tables: { staging: "stg", work: "trabajo", padron: "padron", province: "province", locality: "cadastral_locality" },
    excluded: { staging: ["x"], work: ["y"], padron: [], province: [], locality: [] },
    onSchemaChange: vi.fn(),
    onTableChange: vi.fn(),
    loadTables: vi.fn().mockResolvedValue({ schemaExists: true, tables: [] }),
    checkColumns: vi.fn().mockResolvedValue([]),
    blockingReason: null,
    catalogError: null,
    ...overrides,
  };
  renderToStaticMarkup(React.createElement(ActualizarTablesStep, props));
}

describe("ActualizarTablesStep wiring", () => {
  beforeEach(() => {
    captured.selectors.length = 0;
  });

  it("AP-29: should render five selectors, one per table", () => {
    render();

    expect(selectors()).toHaveLength(5);
  });

  it("AP-28: should list the staging table in the staging schema", () => {
    render();

    expect(selectorLabelled(LABELS.staging).schema).toBe("bdj_carto");
  });

  it.each(["work", "padron", "province", "locality"] as const)(
    "AP-28: should list the %s table in the work schema",
    (key) => {
      render();

      expect(selectorLabelled(LABELS[key]).schema).toBe("carto");
    },
  );

  it("AP-29: should pass each table its own chosen value", () => {
    render();

    expect(selectorLabelled(LABELS.work).value).toBe("trabajo");
    expect(selectorLabelled(LABELS.locality).value).toBe("cadastral_locality");
  });

  it("AP-3: should pass the excluded names of each key to its selector", () => {
    render();

    expect(selectorLabelled(LABELS.staging).excludedTables).toEqual(["x"]);
    expect(selectorLabelled(LABELS.work).excludedTables).toEqual(["y"]);
  });

  it("AP-29: should report a choice with the key of its table", () => {
    const onTableChange = vi.fn();
    render({ onTableChange });

    selectorLabelled(LABELS.padron).onChange("otra_tabla");

    expect(onTableChange).toHaveBeenCalledWith(ActualizarTableKey.PADRON, "otra_tabla", false);
  });

  it("AP-2: should check the columns of each table with the role of its key", () => {
    const checkColumns = vi.fn().mockResolvedValue([]);
    render({ checkColumns });

    void selectorLabelled(LABELS.province).checkColumns("provincias");

    expect(checkColumns).toHaveBeenCalledWith(ActualizarTableKey.PROVINCE, "provincias");
  });

  it("AP-29: should disable a selector while its schema is blank", () => {
    render({ stagingSchema: "", workSchema: "carto" });

    expect(selectorLabelled(LABELS.staging).disabled).toBe(true);
    expect(selectorLabelled(LABELS.work).disabled).toBe(false);
  });
});
