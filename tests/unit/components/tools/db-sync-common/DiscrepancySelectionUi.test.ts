import React, { type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DiscrepancySelectCell } from "@/components/tools/db-sync-common/discrepancies-table/DiscrepancySelectCell";
import { DiscrepanciesTableHead } from "@/components/tools/db-sync-common/discrepancies-table/DiscrepanciesTableHead";
import { DiscrepanciesSelectionBar } from "@/components/tools/db-sync-common/discrepancies-table/DiscrepanciesSelectionBar";
import {
  DiscrepancyType,
  type ComparisonSourceDescriptor,
  type DiscrepancyItem,
} from "@/core/types/comparison";
import { SelectionCheckState } from "@/core/types/selection";

const BLOCKED_TITLE = "Sin clave primaria: no se puede actualizar de forma segura";

const descriptor: ComparisonSourceDescriptor = {
  targetLabel: "Base de Datos",
  targetShortLabel: "DB",
  targetIconKind: "database",
  sourceLabel: "Archivo CSV",
  sourceShortLabel: "CSV",
  sourceIconKind: "file",
};

function item(overrides: Partial<DiscrepancyItem> = {}): DiscrepancyItem {
  return {
    id: "id-1",
    suid: "K-123",
    type: DiscrepancyType.ATTRIBUTE_MISMATCH,
    differences: [],
    ...overrides,
  };
}

function renderCell(props: Partial<React.ComponentProps<typeof DiscrepancySelectCell>> = {}) {
  const el = React.createElement(DiscrepancySelectCell, {
    item: item(),
    rowSpan: 2,
    checked: false,
    blocked: false,
    onToggle: () => undefined,
    ...props,
  });
  return renderToStaticMarkup(
    React.createElement("table", null, React.createElement("tbody", null, React.createElement("tr", null, el)))
  );
}

describe("DiscrepancySelectCell", () => {
  it("should render an unchecked, enabled checkbox with the row aria-label", () => {
    const html = renderCell();
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('aria-label="Seleccionar registro K-123"');
    expect(html).not.toContain("checked");
    expect(html).not.toContain("disabled");
    expect(html).not.toContain("title=");
  });

  it("should render a checked checkbox when selected", () => {
    expect(renderCell({ checked: true })).toContain('checked=""');
  });

  it("should render disabled with the explanatory title when blocked", () => {
    const html = renderCell({ blocked: true });
    expect(html).toContain('disabled=""');
    expect(html).toContain(`title="${BLOCKED_TITLE}"`);
  });

  it("should never render as checked when blocked, even if the id is in the selection", () => {
    expect(renderCell({ blocked: true, checked: true })).not.toContain('checked=""');
  });

  it("should apply the rowSpan to the cell", () => {
    expect(renderCell({ rowSpan: 5 })).toContain('rowSpan="5"');
  });

  it.each([
    DiscrepancyType.ONLY_IN_DB,
    DiscrepancyType.DUPLICATE_SUID,
    DiscrepancyType.NULL_SUID,
    DiscrepancyType.MATCH,
  ])("should render an empty cell without checkbox for %s", (type) => {
    const html = renderCell({ item: item({ type }) });
    expect(html).not.toContain("<input");
    expect(html).toContain("<td");
  });

  it("should call onToggle with the item id when the checkbox changes", () => {
    const onToggle = vi.fn();
    const tree = DiscrepancySelectCell({
      item: item({ id: "zz" }),
      rowSpan: 1,
      checked: false,
      blocked: false,
      onToggle,
    }) as ReactElement<{ children: ReactElement<{ onChange: () => void }> }>;
    tree.props.children.props.onChange();
    expect(onToggle).toHaveBeenCalledWith("zz");
  });
});

type HeadProps = React.ComponentProps<typeof DiscrepanciesTableHead>;

function renderHead(overrides: Partial<HeadProps> = {}) {
  const props: HeadProps = {
    descriptor,
    pageCheckState: SelectionCheckState.NONE,
    hasSelectableOnPage: true,
    onTogglePage: () => undefined,
    ...overrides,
  };
  return renderToStaticMarkup(
    React.createElement("table", null, React.createElement(DiscrepanciesTableHead, props))
  );
}

function findInput(node: ReactNode): ReactElement<{
  ref: (el: { indeterminate: boolean } | null) => void;
  checked: boolean;
}> | null {
  if (Array.isArray(node)) {
    for (const n of node) {
      const f = findInput(n);
      if (f) return f;
    }
    return null;
  }
  if (!node || typeof node !== "object" || !("props" in node)) return null;
  const el = node as ReactElement<{ children?: ReactNode }>;
  if (el.type === "input") return el as never;
  return findInput(el.props.children);
}

function indeterminateFor(state: SelectionCheckState): boolean {
  const tree = DiscrepanciesTableHead({
    descriptor,
    pageCheckState: state,
    hasSelectableOnPage: true,
    onTogglePage: () => undefined,
  });
  const input = findInput(tree as ReactNode)!;
  const fake = { indeterminate: false };
  (input.props as unknown as { ref: (el: typeof fake) => void }).ref(fake);
  return fake.indeterminate;
}

describe("DiscrepanciesTableHead tri-state checkbox", () => {
  const label = 'aria-label="Seleccionar todos los registros de esta página"';

  it("should be unchecked and enabled when none of the page is selected", () => {
    const html = renderHead();
    expect(html).toContain(label);
    expect(html).not.toContain("checked");
    expect(html).not.toContain("disabled");
    expect(indeterminateFor(SelectionCheckState.NONE)).toBe(false);
  });

  it("should be unchecked but indeterminate when some of the page is selected", () => {
    const html = renderHead({ pageCheckState: SelectionCheckState.SOME });
    expect(html).not.toContain('checked=""');
    expect(indeterminateFor(SelectionCheckState.SOME)).toBe(true);
  });

  it("should be checked and not indeterminate when all of the page is selected", () => {
    const html = renderHead({ pageCheckState: SelectionCheckState.ALL });
    expect(html).toContain('checked=""');
    expect(indeterminateFor(SelectionCheckState.ALL)).toBe(false);
  });

  it("should be disabled when the page has no selectable rows", () => {
    expect(renderHead({ hasSelectableOnPage: false })).toContain('disabled=""');
  });

  it("should still render the data column headers", () => {
    const html = renderHead();
    expect(html).toContain("SUID (Identificador)");
    expect(html).toContain("Valor Base de Datos");
    expect(html).toContain("Valor Archivo CSV");
  });
});

type BarProps = React.ComponentProps<typeof DiscrepanciesSelectionBar>;

const barBase: BarProps = {
  selectedCount: 0,
  selectableCount: 10,
  selectedInFilterCount: 0,
  hasSelectableOnPage: true,
  hasSelectableInFilter: true,
  onSelectPage: () => undefined,
  onSelectFiltered: () => undefined,
  onDeselectPage: () => undefined,
  onClear: () => undefined,
};

function renderBar(overrides: Partial<BarProps> = {}) {
  return renderToStaticMarkup(
    React.createElement(DiscrepanciesSelectionBar, { ...barBase, ...overrides })
  );
}

function buttonSegments(html: string): string[] {
  return html.split("<button").slice(1);
}

function strip(html: string): string {
  return html.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, "");
}

describe("DiscrepanciesSelectionBar", () => {
  it("should render the counter as 'N de M seleccionados'", () => {
    const text = strip(renderBar({ selectedCount: 3, selectedInFilterCount: 3 }));
    expect(text).toContain("3 de 10 seleccionados");
  });

  it("should not render the filter breakdown when the filter holds the whole selection", () => {
    expect(strip(renderBar({ selectedCount: 3, selectedInFilterCount: 3 }))).not.toContain(
      "en el filtro actual"
    );
  });

  it("should render the filter breakdown when part of the selection is outside the filter", () => {
    const text = strip(renderBar({ selectedCount: 5, selectedInFilterCount: 2 }));
    expect(text).toContain("(2 en el filtro actual)");
  });

  it("should render the filter breakdown with zero in the filter when a filter hides the whole selection", () => {
    const text = strip(renderBar({ selectedCount: 4, selectedInFilterCount: 0 }));
    expect(text).toContain("(0 en el filtro actual)");
  });

  it("should render the four action buttons", () => {
    const html = renderBar();
    expect(buttonSegments(html)).toHaveLength(4);
    const text = strip(html);
    expect(text).toContain("Seleccionar página");
    expect(text).toContain("Seleccionar todos (filtro actual)");
    expect(text).toContain("Deseleccionar página");
    expect(text).toContain("Limpiar selección");
  });

  it("should disable only the clear button when nothing is selected and everything is selectable", () => {
    const segments = buttonSegments(renderBar({ selectedCount: 0 }));
    expect(segments.map((s) => s.includes('disabled=""'))).toEqual([false, false, false, true]);
  });

  it("should enable the clear button when something is selected", () => {
    const segments = buttonSegments(renderBar({ selectedCount: 1, selectedInFilterCount: 1 }));
    expect(segments[3]).not.toContain('disabled=""');
  });

  it("should disable the page buttons when the page has no selectable rows", () => {
    const segments = buttonSegments(renderBar({ hasSelectableOnPage: false, selectedCount: 1 }));
    expect(segments.map((s) => s.includes('disabled=""'))).toEqual([true, false, true, false]);
  });

  it("should disable the select-filtered button when the filter has no selectable rows", () => {
    const segments = buttonSegments(renderBar({ hasSelectableInFilter: false, selectedCount: 1 }));
    expect(segments.map((s) => s.includes('disabled=""'))).toEqual([false, true, false, false]);
  });

  it("should format large counts with the number formatter", () => {
    const text = strip(renderBar({ selectedCount: 100000, selectableCount: 250000, selectedInFilterCount: 100000 }));
    expect(text).toMatch(/100[.,\s ]?000 de 250[.,\s ]?000 seleccionados/);
  });
});
