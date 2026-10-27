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
  type: "Tabla de tipos de unidad (opcional)",
} as const;

function render(overrides: Partial<Props> = {}): void {
  const props: Props = {
    stagingSchema: "bdj_carto",
    workSchema: "carto",
    cartoSchema: "carto_cat",
    tables: { staging: "stg", work: "trabajo", padron: "padron", province: "province", locality: "cadastral_locality", type: "" },
    excluded: { staging: ["x"], work: ["y"], padron: [], province: [], locality: [], type: [] },
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

  it("AP-29: should render six selectors, one per table including the optional type table", () => {
    render();

    expect(selectors()).toHaveLength(6);
  });

  it("AP-28: should list the staging table in the staging schema", () => {
    render();

    expect(selectorLabelled(LABELS.staging).schema).toBe("bdj_carto");
  });

  it("AP-28: should list the work table in the work schema", () => {
    render();

    expect(selectorLabelled(LABELS.work).schema).toBe("carto");
  });

  it.each(["padron", "province", "locality", "type"] as const)(
    "AP-29: should list the %s table in the carto schema",
    (key) => {
      render();

      expect(selectorLabelled(LABELS[key]).schema).toBe("carto_cat");
    },
  );

  it("AP-29: should pass each table its own chosen value", () => {
    render();

    expect(selectorLabelled(LABELS.work).value).toBe("trabajo");
    expect(selectorLabelled(LABELS.locality).value).toBe("cadastral_locality");
    expect(selectorLabelled(LABELS.type).value).toBe("");
  });

  it("AP-3: should pass the excluded names of each key to its selector", () => {
    render();

    expect(selectorLabelled(LABELS.staging).excludedTables).toEqual(["x"]);
    expect(selectorLabelled(LABELS.work).excludedTables).toEqual(["y"]);
  });

  it("AP-3: should pass the excluded names of the type table to its selector", () => {
    render({ excluded: { staging: [], work: [], padron: [], province: [], locality: [], type: ["padron"] } });

    expect(selectorLabelled(LABELS.type).excludedTables).toEqual(["padron"]);
  });

  it("AP-29: should report a choice with the key of its table", () => {
    const onTableChange = vi.fn();
    render({ onTableChange });

    selectorLabelled(LABELS.padron).onChange("otra_tabla");

    expect(onTableChange).toHaveBeenCalledWith(ActualizarTableKey.PADRON, "otra_tabla", false);
  });

  it("AP-2b: should report a type table choice with the type key", () => {
    const onTableChange = vi.fn();
    render({ onTableChange });

    selectorLabelled(LABELS.type).onChange("tipo_localidad");

    expect(onTableChange).toHaveBeenCalledWith(ActualizarTableKey.TYPE, "tipo_localidad", false);
  });

  it("AP-2: should check the columns of each table with the role of its key", () => {
    const checkColumns = vi.fn().mockResolvedValue([]);
    render({ checkColumns });

    void selectorLabelled(LABELS.province).checkColumns("provincias");

    expect(checkColumns).toHaveBeenCalledWith(ActualizarTableKey.PROVINCE, "provincias");
  });

  it("AP-2b: should check the type table columns with the type key", () => {
    const checkColumns = vi.fn().mockResolvedValue([]);
    render({ checkColumns });

    void selectorLabelled(LABELS.type).checkColumns("tipos");

    expect(checkColumns).toHaveBeenCalledWith(ActualizarTableKey.TYPE, "tipos");
  });

  it("AP-29: should disable a selector while its schema is blank", () => {
    render({ stagingSchema: "", workSchema: "carto" });

    expect(selectorLabelled(LABELS.staging).disabled).toBe(true);
    expect(selectorLabelled(LABELS.work).disabled).toBe(false);
  });

  it("AP-29: should disable the carto selectors, the type table included, while the carto schema is blank", () => {
    render({ cartoSchema: "" });

    for (const label of [LABELS.padron, LABELS.province, LABELS.locality, LABELS.type]) {
      expect(selectorLabelled(label).disabled, label).toBe(true);
    }
    expect(selectorLabelled(LABELS.work).disabled).toBe(false);
  });
});
