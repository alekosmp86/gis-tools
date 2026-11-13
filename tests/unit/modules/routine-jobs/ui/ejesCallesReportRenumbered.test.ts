import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { EjesRenumberedRow, EjesResult } from "@/modules/routine-jobs/jobs/ejes-calles/types";
import { EjesCallesReport } from "@/modules/routine-jobs/ui/EjesCallesReport";
import { EjesMapDetails } from "@/modules/routine-jobs/ui/EjesMapDetails";
import { EJES_SUBJECT_TITLE, subjectOfRenumbered, truncationNoteOf } from "@/modules/routine-jobs/ui/ejesMapSubject";

const COUNTS = {
  newSections: 10,
  unchanged: 0,
  attr: 0,
  geom: 0,
  both: 0,
  removed: 6,
  splits: 0,
  merges: 0,
  plainRemovals: 0,
  plainHeld: 0,
  newStreets: 0,
  twins: 0,
  twinsUrban: 0,
  twinsRural: 0,
  twinsBoth: 0,
  twinsNeither: 0,
  twinsCrossDepartment: 0,
  twinsDrop: 0,
  twinsKeep: 0,
  renumbered: 2,
  renumberedWithPoints: 1,
  renumberedPoints: 4,
};

const ROWS: EjesRenumberedRow[] = [
  { oldRef: "1001634", newRef: "1035386", idcalle: "72006", points: 4, oldLength: 100.55, newLength: 100.64, hausdorff: 0.0123 },
  { oldRef: "1001700", newRef: "1035400", idcalle: null, points: 0, oldLength: null, newLength: 20, hausdorff: null },
];

const resultOf = (renumbered: EjesRenumberedRow[]): EjesResult =>
  ({
    dryRun: true,
    targetModified: false,
    outcomeUnknown: false,
    staging: {
      rows: 0,
      distinctRefs: 0,
      repeatedGroups: 0,
      repeatedRows: 0,
      nonIntegerRefs: 0,
      emptyGeometry: 0,
      emptyIdcalle: 0,
      damagedTextRows: 0,
      unknownTipoRows: 0,
      unknownFuenteRows: 0,
      unknownTipos: [],
      unknownFuentes: [],
      invalidGeometryRows: 0,
      invalidGeometryRefs: 0,
      invalidGeometries: [],
    },
    counts: { ...COUNTS, renumbered: renumbered.length },
    cloc: { withLocality: 0, onlyDepartment: 0, withoutCode: 0 },
    splits: [],
    merges: [],
    plainRemovals: [],
    newStreets: [],
    attrChanges: [],
    twins: [],
    renumbered,
    blockers: [],
    privilegeInfo: [],
    tables: {},
    stepTimings: [],
  }) as unknown as EjesResult;

const render = (renumbered: EjesRenumberedRow[]): string =>
  renderToStaticMarkup(React.createElement(EjesCallesReport, { result: resultOf(renumbered), mapBase: null }));

describe("EjesCallesReport renumbered (ER-4)", () => {
  it("should show the three renumbered KPIs and Nuevos without the renumbered news", () => {
    const html = render(ROWS);

    expect(html).toContain("Renumerados (mismo trazado, otro reftramo)");
    expect(html).toContain("Renumerados con puntos de acceso");
    expect(html).toContain("Puntos de acceso que seguirían al renumerar");
    expect(html).toContain("Nuevos");
  });

  it("should show a collapsible list Tramos renumerados with the six columns and a Ver en mapa button per row", () => {
    const html = render(ROWS);

    expect(html).toContain("Tramos renumerados");
    for (const header of ["reftramo anterior", "reftramo nuevo", "idcalle", "Puntos de acceso", "Largo anterior (m)", "Largo nuevo (m)"]) {
      expect(html).toContain(`>${header}</th>`);
    }
    expect(html.match(/aria-label="Ver en mapa"/g)).toHaveLength(2);
  });

  it("should show the cells of a row: both references, idcalle, points and the lengths with one decimal, sin dato for null", () => {
    const html = render(ROWS);

    expect(html).toContain("1001634");
    expect(html).toContain("1035386");
    expect(html).toContain("72006");
    expect(html).toContain("100.6");
    expect(html).toContain("100.5");
    expect(html).toContain("20.0");
    expect(html).toContain("sin dato");
  });

  it("should hide the list, and show no Ver en mapa for it, when there are no renumbered rows", () => {
    const html = render([]);

    expect(html).not.toContain("Tramos renumerados (");
    expect(html).not.toContain("Ver en mapa");
  });
});

describe("subjectOfRenumbered (ER-5)", () => {
  const subject = subjectOfRenumbered(ROWS[0]);

  it("should be titled Tramo renumerado", () => {
    expect(subject.title).toBe(EJES_SUBJECT_TITLE.RENUMBERED);
    expect(subject.title).toBe("Tramo renumerado");
  });

  it("should reuse the existing map request: the old section as oldRef number, then the new one as newRef text", () => {
    expect(subject.items).toEqual([{ oldRef: 1001634 }, { newRef: "1035386" }]);
  });

  it("should draw the old section first (below) and the new one last (on top), with the old and new section colours", () => {
    expect(subject.outlines.map((outline) => outline.role)).toEqual(["old", "new"]);
    expect(subject.outlines.map((outline) => outline.mapType)).toEqual(["TRAMO_ANTERIOR", "TRAMO_NUEVO"]);
  });

  it("should label the outlines by reftramo and old or new", () => {
    expect(subject.outlines.map((outline) => outline.label)).toEqual(["1001634 · anterior", "1035386 · nuevo"]);
    expect(subject.outlines.map((outline) => outline.ref)).toEqual(["1001634", "1035386"]);
  });

  it("should keep the items and the outlines parallel and show no cut note", () => {
    expect(subject.items).toHaveLength(subject.outlines.length);
    expect(subject.total).toBe(2);
    expect(truncationNoteOf(subject)).toBeNull();
  });

  it("should carry the facts and the Hausdorff distance, and no twin facts", () => {
    expect(subject.facts).toEqual({ idcalle: "72006", points: 4, coverage: null, oldLength: 100.55, newLength: 100.64, outsideLength: null });
    expect(subject.renumbered).toEqual({ hausdorff: 0.0123 });
    expect(subject.twin).toBeUndefined();
  });

  it("should carry a null Hausdorff distance and null lengths of a row that has none", () => {
    const empty = subjectOfRenumbered(ROWS[1]);

    expect(empty.renumbered).toEqual({ hausdorff: null });
    expect(empty.facts.oldLength).toBeNull();
    expect(empty.facts.idcalle).toBeNull();
  });
});

describe("EjesMapDetails renumbered row (ER-5)", () => {
  const html = (row: EjesRenumberedRow): string =>
    renderToStaticMarkup(React.createElement(EjesMapDetails, { subject: subjectOfRenumbered(row), outline: null }));

  it("should show the idcalle, the access points, the two lengths and the Hausdorff distance in metres", () => {
    const view = html(ROWS[0]);

    expect(view).toContain("idcalle");
    expect(view).toContain("72006");
    expect(view).toContain("Puntos de acceso");
    expect(view).toContain("Largo anterior (m)");
    expect(view).toContain("100.5");
    expect(view).toContain("Largo nuevo (m)");
    expect(view).toContain("100.6");
    expect(view).toContain("Distancia máxima entre trazados (m)");
    expect(view).toContain("0.0");
  });

  it("should show sin dato for a null length or distance", () => {
    expect(html(ROWS[1]).match(/sin dato/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("should not show the split, merge or twin facts", () => {
    const view = html(ROWS[0]);

    expect(view).not.toContain("Cobertura");
    expect(view).not.toContain("Nuevo fuera del anterior");
    expect(view).not.toContain("Localidades");
    expect(view).not.toContain("Qué pasa");
  });

  it("should list the old and the new section to select", () => {
    const list = renderToStaticMarkup(
      React.createElement(EjesMapDetails, {
        subject: subjectOfRenumbered(ROWS[0]),
        outline: null,
        selectedOutlineIndex: null,
        onSelectOutline: () => undefined,
      })
    );

    expect(list).toContain("1001634 · anterior");
    expect(list).toContain("1035386 · nuevo");
  });
});
