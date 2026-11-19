import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RENUMBER_SKIP_REASON } from "@/modules/routine-jobs/jobs/ejes-calles/constants";
import type { EjesRenumberSkippedRow, EjesResult } from "@/modules/routine-jobs/jobs/ejes-calles/types";
import { EjesCallesReport } from "@/modules/routine-jobs/ui/ejes-calles/EjesCallesReport";
import { EJES_LIST, stripOf, type EjesListKey } from "@/modules/routine-jobs/ui/ejes-calles/ejesCallesListMeta";
import { EjesSummaryStrip } from "@/modules/routine-jobs/ui/ejes-calles/EjesSummaryStrip";
import { heldRenumberKeyOf, heldRenumberViewsOf } from "@/modules/routine-jobs/ui/ejes-calles/ejesRenumberHeldView";
import { RENUMBER_SKIP_TEXT } from "@/modules/routine-jobs/ui/ejes-calles/ejesLoadTexts";

const HELD_TITLE = "Renumerados retenidos (ambos tramos quedan como están)";
const ANCHOR = 'id="ejes-list-renumberHeld"';
const MAP_BUTTON = 'aria-label="Ver en mapa"';

const HELD_ROWS: EjesRenumberSkippedRow[] = [
  { oldRef: "3001", newRef: "3002", idcalle: "5", points: 2, reason: RENUMBER_SKIP_REASON.REPEATED_OLD_REF },
  { oldRef: "3011", newRef: "3012", idcalle: "6", points: 0, reason: RENUMBER_SKIP_REASON.AMBIGUOUS_OLD_REF },
  { oldRef: "3021", newRef: "3022", idcalle: null, points: 4, reason: RENUMBER_SKIP_REASON.AMBIGUOUS_NEW_REF },
  { oldRef: "3031", newRef: "3032", idcalle: "8", points: 1, reason: RENUMBER_SKIP_REASON.NOT_SINGLE_COPY },
];

const COUNTS = {
  newSections: 0,
  unchanged: 0,
  attr: 0,
  geom: 0,
  both: 0,
  removed: 0,
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
  twinsUndecided: 0,
  twinPicksApplied: 0,
  renumbered: 0,
  renumberedWithPoints: 0,
  renumberedPoints: 0,
  renumberSkipped: HELD_ROWS.length,
};

const resultOf = (renumberSkipped: EjesRenumberSkippedRow[] = HELD_ROWS): EjesResult =>
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
    counts: { ...COUNTS, renumberSkipped: renumberSkipped.length },
    cloc: { withLocality: 0, onlyDepartment: 0, withoutCode: 0 },
    splits: [],
    merges: [],
    plainRemovals: [],
    newStreets: [],
    attrChanges: [],
    twinUndecided: [],
    geoTwins: [],
    renumbered: [],
    renumberSkipped,
    renumberDropped: [],
    keptByDiscarded: [],
    blockers: [],
    privilegeInfo: [],
    tables: {},
    stepTimings: [],
  }) as unknown as EjesResult;

const render = (renumberSkipped: EjesRenumberSkippedRow[] = HELD_ROWS): string =>
  renderToStaticMarkup(React.createElement(EjesCallesReport, { result: resultOf(renumberSkipped), mapBase: null }));

describe("EjesCallesReport held renumbers list (EJ-25, EJL-12)", () => {
  it("should show a collapsible list titled Renumerados retenidos with its analysis count and anchor", () => {
    const html = render();

    expect(html).toContain(`${HELD_TITLE} (${HELD_ROWS.length})`);
    expect(html).toContain(ANCHOR);
  });

  it("should show the columns reftramo anterior, Candidatos, idcalle, Puntos de acceso and Motivo", () => {
    const html = render();

    for (const header of ["reftramo anterior", "Candidatos", "idcalle", "Puntos de acceso", "Motivo"]) {
      expect(html).toContain(`>${header}</th>`);
    }
  });

  it("should show the old ref, the candidate, the points and the reason of each held row, sin dato for a null street", () => {
    const html = render();

    for (const row of HELD_ROWS) {
      expect(html).toContain(`>${row.oldRef}</td>`);
      expect(html).toContain(`>${row.newRef}</td>`);
      expect(html).toContain(`>${String(row.points)}</td>`);
    }
    expect(html).toContain(">sin dato</td>");
  });

  it.each(Object.values(RENUMBER_SKIP_REASON))("should give the reason %s its Spanish label in the Motivo column", (reason) => {
    const html = render([{ ...HELD_ROWS[0], reason }]);

    expect(html).toContain(`>${RENUMBER_SKIP_TEXT[reason]}</td>`);
  });

  it("should show the four Spanish reason labels, one for each reason, when all four are held", () => {
    const html = render();

    expect(html).toContain(`>${RENUMBER_SKIP_TEXT.repeated_old_ref}</td>`);
    expect(html).toContain(`>${RENUMBER_SKIP_TEXT.ambiguous_old_ref}</td>`);
    expect(html).toContain(`>${RENUMBER_SKIP_TEXT.ambiguous_new_ref}</td>`);
    expect(html).toContain(`>${RENUMBER_SKIP_TEXT.not_single_copy}</td>`);
  });

  it("should offer one Ver en mapa button per held row", () => {
    const html = render();

    expect(html.match(/aria-label="Ver en mapa"/g)).toHaveLength(HELD_ROWS.length);
  });

  it("should list the candidates of an old reftramo with several candidates on one row", () => {
    const html = render([
      { oldRef: "3011", newRef: "3012", idcalle: "6", points: 1, reason: RENUMBER_SKIP_REASON.AMBIGUOUS_OLD_REF },
      { oldRef: "3011", newRef: "3013", idcalle: "6", points: 1, reason: RENUMBER_SKIP_REASON.AMBIGUOUS_OLD_REF },
    ]);

    expect(html).toContain(">3012, 3013</td>");
    expect(html.match(/>3011<\/td>/g)).toHaveLength(1);
    expect(html.match(/aria-label="Ver en mapa"/g)).toHaveLength(1);
  });

  it("should omit the held list when no renumber was held back", () => {
    const html = render([]);

    expect(html).not.toContain(ANCHOR);
    expect(html).not.toContain(HELD_TITLE);
    expect(html).not.toContain(MAP_BUTTON);
  });
});

describe("heldRenumberViewsOf (EJ-25)", () => {
  const ambiguous = (oldRef: string, newRef: string): EjesRenumberSkippedRow => ({
    oldRef,
    newRef,
    idcalle: "7",
    points: 3,
    reason: RENUMBER_SKIP_REASON.AMBIGUOUS_OLD_REF,
  });

  it("should return no view for no held rows", () => {
    expect(heldRenumberViewsOf([])).toEqual([]);
  });

  it("should keep one view per pair for every reason other than an ambiguous old reftramo", () => {
    const views = heldRenumberViewsOf(HELD_ROWS.filter((row) => row.reason !== RENUMBER_SKIP_REASON.AMBIGUOUS_OLD_REF));

    expect(views.map((view) => [view.oldRef, view.newRefs])).toEqual([
      ["3001", ["3002"]],
      ["3021", ["3022"]],
      ["3031", ["3032"]],
    ]);
  });

  it("should group the ambiguous rows of one old reftramo into one view, with every candidate in order of appearance", () => {
    const views = heldRenumberViewsOf([ambiguous("3011", "3013"), ambiguous("3012", "3014"), ambiguous("3011", "3012")]);

    expect(views).toEqual([
      { oldRef: "3011", newRefs: ["3013", "3012"], idcalle: "7", points: 3, reason: RENUMBER_SKIP_REASON.AMBIGUOUS_OLD_REF },
      { oldRef: "3012", newRefs: ["3014"], idcalle: "7", points: 3, reason: RENUMBER_SKIP_REASON.AMBIGUOUS_OLD_REF },
    ]);
  });

  it("should not merge a repeated-old-reftramo row into a view of the same old reftramo", () => {
    const repeated: EjesRenumberSkippedRow = { ...ambiguous("3011", "3013"), reason: RENUMBER_SKIP_REASON.REPEATED_OLD_REF };
    const views = heldRenumberViewsOf([repeated, ambiguous("3011", "3012")]);

    expect(views.map((view) => view.newRefs)).toEqual([["3013"], ["3012"]]);
  });

  it("should give every view its own key, so two views of one old reftramo never collide", () => {
    const keys = heldRenumberViewsOf([ambiguous("3011", "3013"), ambiguous("3011", "3012"), ambiguous("3020", "3021")]).map(heldRenumberKeyOf);

    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("EjesSummaryStrip held cell", () => {
  const heldCell = (count: number) => {
    const result = resultOf(HELD_ROWS.slice(0, count));
    const item = stripOf(result).find((candidate) => candidate.list === EJES_LIST.RENUMBER_HELD);
    if (item === undefined) throw new Error("the strip has no held cell");
    return item;
  };
  const strip = (count: number): string =>
    renderToStaticMarkup(React.createElement(EjesSummaryStrip, { items: [heldCell(count)], openLists: new Set<EjesListKey>(), onSelect: () => undefined }));

  it("should show the held cell disabled when no renumber was held back", () => {
    expect(strip(0)).toContain("disabled");
  });

  it("should show the held cell enabled when a renumber was held back", () => {
    const html = strip(HELD_ROWS.length);

    expect(html).not.toContain("disabled");
    expect(html).toContain("Renumerados retenidos");
  });
});
