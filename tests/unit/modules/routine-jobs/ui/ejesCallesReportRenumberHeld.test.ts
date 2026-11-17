import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RENUMBER_SKIP_REASON } from "@/modules/routine-jobs/jobs/ejes-calles/constants";
import type { EjesRenumberSkippedRow, EjesResult } from "@/modules/routine-jobs/jobs/ejes-calles/types";
import { EjesCallesReport } from "@/modules/routine-jobs/ui/ejes-calles/EjesCallesReport";
import { EJES_LIST, stripOf, type EjesListKey } from "@/modules/routine-jobs/ui/ejes-calles/ejesCallesListMeta";
import { EjesSummaryStrip } from "@/modules/routine-jobs/ui/ejes-calles/EjesSummaryStrip";
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
    twins: [],
    geoTwins: [],
    renumbered: [],
    renumberSkipped,
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

  it("should show the columns reftramo anterior, reftramo nuevo, idcalle, Puntos de acceso and Motivo", () => {
    const html = render();

    for (const header of ["reftramo anterior", "reftramo nuevo", "idcalle", "Puntos de acceso", "Motivo"]) {
      expect(html).toContain(`>${header}</th>`);
    }
  });

  it("should show both refs, the street, the points and the reason of each held row", () => {
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

  it("should offer no Ver en mapa button on any held row", () => {
    const html = render();

    expect(html).not.toContain(MAP_BUTTON);
    expect(html).not.toContain("Ver en mapa");
  });

  it("should omit the held list when no renumber was held back", () => {
    const html = render([]);

    expect(html).not.toContain(ANCHOR);
    expect(html).not.toContain(HELD_TITLE);
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
