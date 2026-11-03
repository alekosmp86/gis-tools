import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { GEOMETRY_STATE } from "@/modules/routine-jobs/jobs/actualizar-padron/constants";
import type { PadronGeometryChange } from "@/modules/routine-jobs/jobs/actualizar-padron/types";
import { GeometryChangesSection, type GeometryChangesSectionProps } from "@/modules/routine-jobs/ui/GeometryChangesSection";
import { readOnlyAcceptsOf, type GeometryAcceptSelection } from "@/modules/routine-jobs/ui/reviewDecisions";

const changeOf = (overrides: Partial<PadronGeometryChange> = {}): PadronGeometryChange => ({
  typePadron: "URBANO",
  provinceId: 1,
  localityId: 10,
  number: "200",
  department: "MONTEVIDEO",
  locality: "CENTRO",
  oldId: 7,
  state: GEOMETRY_STATE.PENDING,
  oldAreaM2: 10000,
  newAreaM2: 10700,
  areaChangePct: 6.5,
  centroidLat: -34.9,
  centroidLon: -56.2,
  ...overrides,
});

const editableOf = (overrides: Partial<GeometryAcceptSelection> = {}): GeometryAcceptSelection => ({
  accepted: [],
  submitted: [],
  onAcceptMany: vi.fn(),
  onRejectMany: vi.fn(),
  onAcceptAll: vi.fn(),
  onRejectAll: vi.fn(),
  ...overrides,
});

interface RenderProps {
  selection: GeometryAcceptSelection;
  changes?: PadronGeometryChange[];
  pendingTotal?: number;
}

const render = ({ selection, changes = [changeOf()], pendingTotal = 1 }: RenderProps): string => {
  const props: GeometryChangesSectionProps = {
    changes,
    summary: "Geometrías pendientes",
    pendingTotal,
    selection,
    canResimulate: false,
    onOpenReview: vi.fn(),
  };
  return renderToStaticMarkup(React.createElement(GeometryChangesSection, props));
};

const buttonsOf = (html: string): string[] => html.match(/<button[\s\S]*?<\/button>/g) ?? [];

const buttonWith = (html: string, label: string): string => buttonsOf(html).find((button) => button.includes(label)) ?? "";

describe("GeometryChangesSection with the accept-all flag off (AP-118)", () => {
  it("should offer the Aceptar todas button with the pending total as its label", () => {
    const html = render({ selection: editableOf(), pendingTotal: 5 });

    expect(html).toContain("Aceptar todas (5)");
    expect(html).not.toContain("Todas las geometrías pendientes aceptadas");
  });

  it("should enable the Aceptar todas button when the pending total is above zero", () => {
    const button = buttonWith(render({ selection: editableOf(), pendingTotal: 5 }), "Aceptar todas (5)");

    expect(button).not.toBe("");
    expect(button).not.toContain("disabled");
  });

  it("should disable the Aceptar todas button when the pending total is zero", () => {
    const button = buttonWith(render({ selection: editableOf(), pendingTotal: 0 }), "Aceptar todas (0)");

    expect(button).not.toBe("");
    expect(button).toContain("disabled");
  });

  it("should state that the acceptance covers every pending geometry, not only the listed ones", () => {
    expect(render({ selection: editableOf() })).toContain("La aceptación aplica a todas las geometrías pendientes, no solo a las listadas.");
  });

  it("should fall back to the listed-only Aceptar todos button when the selection has no accept-all callback", () => {
    const html = render({ selection: editableOf({ onAcceptAll: undefined }) });

    expect(html).toContain("Aceptar todos");
    expect(html).not.toContain("Aceptar todas (");
  });

  it("should render nothing when there are no listed changes and the flag is off", () => {
    expect(render({ changes: [], selection: editableOf() })).toBe("");
  });
});

describe("GeometryChangesSection with the accept-all flag on (AP-118)", () => {
  it("should show the banner with the count and the Rechazar todas button, without the list or the Aceptar todas button", () => {
    const html = render({ selection: editableOf({ acceptAll: true, acceptAllCount: 7 }) });

    expect(html).toContain("Todas las geometrías pendientes aceptadas (7)");
    expect(html).toContain("Rechazar todas");
    expect(html).not.toContain("Aceptar todas (");
    expect(html).not.toContain("Aceptar todos");
    expect(html).not.toContain("<table");
  });

  it("should show the banner without a number when the count is zero", () => {
    const html = render({ selection: editableOf({ acceptAll: true, acceptAllCount: 0 }) });

    expect(html).toContain("Todas las geometrías pendientes aceptadas");
    expect(html).not.toContain("Todas las geometrías pendientes aceptadas (");
  });

  it("should show the banner without a number when the count is absent", () => {
    const html = render({ selection: editableOf({ acceptAll: true }) });

    expect(html).toContain("Todas las geometrías pendientes aceptadas");
    expect(html).not.toContain("Todas las geometrías pendientes aceptadas (");
  });

  it("should still show the banner when the list of changes is empty", () => {
    const html = render({ changes: [], selection: editableOf({ acceptAll: true, acceptAllCount: 3 }) });

    expect(html).toContain("Todas las geometrías pendientes aceptadas (3)");
  });

  it("should state that the acceptance covers every pending geometry", () => {
    const html = render({ selection: editableOf({ acceptAll: true, acceptAllCount: 3 }) });

    expect(html).toContain("La aceptación aplica a todas las geometrías pendientes, no solo a las listadas.");
  });
});

describe("GeometryChangesSection read-only (AP-118)", () => {
  it("should show no accept or reject buttons without the selection callbacks", () => {
    const html = render({ selection: readOnlyAcceptsOf([]) });

    expect(buttonsOf(html).filter((button) => /Aceptar|Rechazar/.test(button))).toEqual([]);
  });

  it("should show the banner but no buttons for a read-only result whose run accepted every geometry", () => {
    const html = render({ selection: { ...readOnlyAcceptsOf([]), acceptAll: true, submittedAcceptAll: true, acceptAllCount: 4 } });

    expect(html).toContain("Todas las geometrías pendientes aceptadas (4)");
    expect(html).not.toContain("Rechazar todas");
    expect(buttonsOf(html).filter((button) => /Aceptar|Rechazar/.test(button))).toEqual([]);
  });
});
