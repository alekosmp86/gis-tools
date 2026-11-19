import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { EjesRemovalRow, EjesResult, EjesSplitRow } from "@/modules/routine-jobs/jobs/ejes-calles/types";
import {
  isPlainRemovalAcceptable,
  isReplacementSplit,
  plainRemovalNotAcceptableText,
  type EjesAcceptView,
} from "@/modules/routine-jobs/ui/ejes-calles/ejesAccept";
import { EJES_ACCEPT_TEXT } from "@/modules/routine-jobs/ui/ejes-calles/ejesAcceptTexts";
import { EJES_COMPACT_TEXT } from "@/modules/routine-jobs/ui/ejes-calles/compact/ejesCompactTexts";
import { splitColumnsOf } from "@/modules/routine-jobs/ui/ejes-calles/compact/ejesSplitColumns";
import { EJES_SUBJECT_TITLE, subjectOfSplit } from "@/modules/routine-jobs/ui/ejes-calles/ejesMapSubject";
import { EjesResultStep, type EjesResultStepProps } from "@/modules/routine-jobs/ui/ejes-calles/steps/EjesResultStep";
import type { EjesRunSnapshot } from "@/modules/routine-jobs/ui/shared/ejesCallesRunStore";
import { RunPhase } from "@/modules/routine-jobs/ui/shared/jobRunStore";

const splitOf = (newRefs: string[]): EjesSplitRow => ({
  oldRef: "6901",
  idcalle: "14",
  newRefs,
  points: 1,
  refPoints: 1,
  autoPoints: 1,
  reviewPoints: 0,
  noGeometryPoints: 0,
  farPoints: 0,
  heldReason: null,
  incompleteReview: false,
  coverage: 1,
  oldLength: 100,
  newLength: 150,
  outsideLength: 50,
});

const REPLACEMENT_ROW = splitOf(["6902"]);
const TWO_PIECE_ROW = splitOf(["6902", "6903"]);

const cellText = (row: EjesSplitRow, column: number): string => {
  const cell = splitColumnsOf()[column].cell(row);
  return renderToStaticMarkup(React.createElement(React.Fragment, null, cell));
};

const FREE_REMOVAL: EjesRemovalRow = { ref: "5001", idcalle: "5", points: 0 };
const POINTS_REMOVAL: EjesRemovalRow = { ref: "5002", idcalle: "5", points: 2 };
const NO_REF_REMOVAL: EjesRemovalRow = { ref: "", idcalle: null, points: 0 };

const acceptView = (): EjesAcceptView => ({
  keys: { splits: [], plainRemovals: [], merges: [], twinRemovals: [] },
  pointChoices: [],
  onChange: () => undefined,
  onPointChoicesChange: () => undefined,
  twinPicks: [],
  onTwinPickChange: () => undefined,
  canAnalyzeWithPicks: false,
  onAnalyzeWithPicks: () => undefined,
});

const resultOf = (plainRemovals: EjesRemovalRow[]): EjesResult =>
  ({
    dryRun: true,
    targetModified: false,
    outcomeUnknown: false,
    staging: {
      rows: 1,
      distinctRefs: 1,
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
    counts: { newSections: 0, unchanged: 0, attr: 0, geom: 0, both: 0, removed: plainRemovals.length, splits: 0, merges: 0, plainRemovals: plainRemovals.length, plainHeld: 0, newStreets: 0, twins: 0, twinsUrban: 0, twinsRural: 0, twinsBoth: 0, twinsNeither: 0, twinsCrossDepartment: 0, twinsDrop: 0, twinsKeep: 0, renumbered: 0, renumberedWithPoints: 0, renumberedPoints: 0, renumberSkipped: 0 },
    fingerprint: { rows: 1, digest: "0123456789abcdef0123456789abcdef" },
    cloc: { withLocality: 0, onlyDepartment: 0, withoutCode: 0 },
    splits: [],
    merges: [],
    plainRemovals,
    newStreets: [],
    twins: [],
    twinUndecided: [],
    geoTwins: [],
    renumbered: [],
    renumberSkipped: [],
    renumberDropped: [],
    attrChanges: [],
    blockers: [],
    privilegeInfo: [],
    tables: {},
    stepTimings: [{ label: "a", ms: 1500 }],
  }) as unknown as EjesResult;

const resultStepOf = (result: EjesResult, accept: EjesAcceptView): string => {
  const snapshot = { phase: RunPhase.DONE, job: { state: "DONE", result }, plan: undefined } as unknown as EjesRunSnapshot;
  const props: EjesResultStepProps = {
    snapshot,
    nowMs: 0,
    mapBase: null,
    canLoad: false,
    accept,
    onLoad: () => undefined,
    onNewRun: () => undefined,
    onBackToReview: () => undefined,
  };
  return renderToStaticMarkup(React.createElement(EjesResultStep, props));
};

describe("isReplacementSplit (EJ-10 one-piece replacement)", () => {
  it("should be true when the split has exactly one new section", () => {
    expect(isReplacementSplit(REPLACEMENT_ROW)).toBe(true);
  });

  it("should be false when the split has two new sections", () => {
    expect(isReplacementSplit(TWO_PIECE_ROW)).toBe(false);
  });

  it("should be false when the split has no new section", () => {
    expect(isReplacementSplit(splitOf([]))).toBe(false);
  });
});

describe("replacement label and map title (EJ-10)", () => {
  it("should label the pieces cell 'Reemplazo' for a one-piece split", () => {
    expect(cellText(REPLACEMENT_ROW, 1)).toContain(EJES_COMPACT_TEXT.REPLACEMENT);
  });

  it("should label the pieces cell with the piece count, not 'Reemplazo', for a two-piece split", () => {
    const out = cellText(TWO_PIECE_ROW, 1);

    expect(out).toContain(EJES_COMPACT_TEXT.PIECE_COUNT(2));
    expect(out).not.toContain(EJES_COMPACT_TEXT.REPLACEMENT);
  });

  it("should title the map subject of a one-piece split as a replacement", () => {
    expect(subjectOfSplit(REPLACEMENT_ROW).title).toBe(EJES_SUBJECT_TITLE.REPLACEMENT);
  });
});

describe("isPlainRemovalAcceptable (EJ-21, EJS-9)", () => {
  it("should be true for a plain removal with a reftramo and no access points", () => {
    expect(isPlainRemovalAcceptable(FREE_REMOVAL)).toBe(true);
  });

  it("should be false for a plain removal that still has access points", () => {
    expect(isPlainRemovalAcceptable(POINTS_REMOVAL)).toBe(false);
  });

  it("should be false for a plain removal with no reftramo", () => {
    expect(isPlainRemovalAcceptable(NO_REF_REMOVAL)).toBe(false);
  });

  it("should name the missing receiving section when the removal has points, and the no-reftramo text when it has no reftramo", () => {
    expect(plainRemovalNotAcceptableText(POINTS_REMOVAL)).toBe(EJES_ACCEPT_TEXT.NO_RECEIVING_SECTION);
    expect(plainRemovalNotAcceptableText(NO_REF_REMOVAL)).toBe(EJES_ACCEPT_TEXT.NOT_ACCEPTABLE);
  });
});

describe("plain removal list render (EJ-21)", () => {
  it("should show the accept button only on the acceptable row, and the receiving-section text on the row with points", () => {
    const out = resultStepOf(resultOf([FREE_REMOVAL, POINTS_REMOVAL]), acceptView());

    expect(out.split(`<span>${EJES_ACCEPT_TEXT.ACCEPT}</span>`).length - 1).toBe(1);
    expect(out).toContain(EJES_ACCEPT_TEXT.NO_RECEIVING_SECTION);
  });

  it("should show the no-reftramo text on a removal with no reftramo, and never the replacement note", () => {
    const out = resultStepOf(resultOf([NO_REF_REMOVAL]), acceptView());

    expect(out).toContain(EJES_ACCEPT_TEXT.NOT_ACCEPTABLE);
    expect(out).not.toContain(EJES_ACCEPT_TEXT.REPLACEMENT_NOTE);
  });
});
