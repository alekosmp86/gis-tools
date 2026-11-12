import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TableSelectorProps } from "@/ui-kit/components/TableSelector";
import { EJES_ROLES, EJES_TABLE_ROLE } from "@/modules/routine-jobs/jobs/ejes-calles/constants";
import { EJES_ROLE_TITLES } from "@/modules/routine-jobs/ui/ejesCallesTexts";
import { initialEjesWizardState, excludedEjesTablesOf } from "@/modules/routine-jobs/ui/ejesCallesWizardState";
import { EjesTablesStep } from "@/modules/routine-jobs/ui/steps/EjesTablesStep";

const captured = vi.hoisted(() => ({ selectors: [] as unknown[] }));

vi.mock("@/ui-kit/components/TableSelector", () => ({
  TableSelector: (props: unknown) => {
    captured.selectors.push(props);
    return null;
  },
}));

type Props = React.ComponentProps<typeof EjesTablesStep>;

const selectors = (): TableSelectorProps[] => captured.selectors as TableSelectorProps[];

function propsOf(): Props {
  const state = initialEjesWizardState();
  return {
    slots: state.slots,
    excluded: excludedEjesTablesOf(state),
    onSchemaChange: vi.fn(),
    onTableChange: vi.fn(),
    loadTables: vi.fn().mockResolvedValue({ schemaExists: true, tables: [] }),
    checkColumns: vi.fn().mockResolvedValue([]),
    blockingReason: null,
    catalogError: null,
  };
}

describe("EjesTablesStep ejes-padrones (ET-1)", () => {
  beforeEach(() => {
    captured.selectors.length = 0;
  });

  it("should render one selector per role, the padrones table included, labelled Tabla de padrones", () => {
    const html = renderToStaticMarkup(React.createElement(EjesTablesStep, propsOf()));

    expect(selectors()).toHaveLength(EJES_ROLES.length);
    expect(selectors().map((props) => props.label)).toContain("Tabla de padrones");
    expect(html).toContain("Padrones");
    expect(html).toContain("Solo se lee.");
  });

  it("should word the localities note with nomloc and the twins decision (ET-12)", () => {
    const html = renderToStaticMarkup(React.createElement(EjesTablesStep, propsOf()));

    expect(html).toContain(
      "Calcula el cloc_iso de los tramos y, con nomloc, decide los tramos repetidos lejos de los padrones. Solo se lee."
    );
  });

  it("should title the role Padrones", () => {
    expect(EJES_ROLE_TITLES[EJES_TABLE_ROLE.PADRONES]).toBe("Padrones");
  });

  it("should list the padrones table in its default schema and check its columns with the ejes-padrones role", async () => {
    const props = propsOf();
    renderToStaticMarkup(React.createElement(EjesTablesStep, props));
    const padrones = selectors().find((selector) => selector.label === "Tabla de padrones");

    expect(padrones?.schema).toBe("carto");
    expect(padrones?.value).toBe("padron");
    await padrones?.checkColumns("padron");
    expect(props.checkColumns).toHaveBeenCalledWith(EJES_TABLE_ROLE.PADRONES, "carto", "padron");
  });
});
