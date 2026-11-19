import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ACCEPTED_KEYS_LIMIT } from "@/modules/routine-jobs/jobs/ejes-calles/constants";
import type { EjesResult } from "@/modules/routine-jobs/jobs/ejes-calles/types";
import { EjesAcceptableRows } from "@/modules/routine-jobs/ui/ejes-calles/EjesAcceptableRows";
import { EjesAcceptToolbar } from "@/modules/routine-jobs/ui/ejes-calles/EjesAcceptToolbar";
import { EjesAcceptList, type EjesAcceptView } from "@/modules/routine-jobs/ui/ejes-calles/ejesAccept";
import { EJES_ACCEPT_TEXT, acceptedCountTextOf, incompleteListTextOf } from "@/modules/routine-jobs/ui/ejes-calles/ejesAcceptTexts";
import type { EjesRunSnapshot } from "@/modules/routine-jobs/ui/shared/ejesCallesRunStore";
import { RunPhase } from "@/modules/routine-jobs/ui/shared/jobRunStore";
import { EjesResultStep, type EjesResultStepProps } from "@/modules/routine-jobs/ui/ejes-calles/steps/EjesResultStep";
import type { TableColumn } from "@/modules/routine-jobs/ui/shared/ReportParts";

const COUNTS = {
  newSections: 2,
  unchanged: 10,
  attr: 0,
  geom: 0,
  both: 0,
  removed: 2,
  splits: 1,
  merges: 1,
  plainRemovals: 1,
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
  renumberSkipped: 0,
};

const MERGE_ROW = { newRef: "6103", idcalle: "7", oldRefs: ["6101", "6102"], points: 3, coverage: 1, oldLength: 100, newLength: 100, outsideLength: 0 };
const PLAIN_ROW = { ref: "5001", idcalle: "5", points: 0 };
const SPLIT_ROW = { oldRef: "6901", idcalle: "14", newRefs: ["6902", "6903"], points: 1, refPoints: 1, autoPoints: 1, reviewPoints: 0, noGeometryPoints: 0, farPoints: 0, coverage: 1, oldLength: 100, newLength: 100, outsideLength: 0 };

const resultOf = (overrides: Partial<EjesResult> = {}): EjesResult =>
  ({
    dryRun: true,
    targetModified: false,
    outcomeUnknown: false,
    staging: {
      rows: 4,
      distinctRefs: 4,
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
    counts: COUNTS,
    fingerprint: { rows: 4, digest: "0123456789abcdef0123456789abcdef" },
    cloc: { withLocality: 0, onlyDepartment: 0, withoutCode: 0 },
    splits: [SPLIT_ROW],
    merges: [MERGE_ROW],
    plainRemovals: [PLAIN_ROW],
    newStreets: [],
    twins: [],
    twinUndecided: [],
    geoTwins: [],
    renumbered: [],
    renumberSkipped: [],
    attrChanges: [],
    blockers: [],
    privilegeInfo: [],
    tables: {},
    stepTimings: [{ label: "a", ms: 1500 }],
    ...overrides,
  }) as unknown as EjesResult;

const doneStep = (result: EjesResult, accept?: EjesAcceptView): string => {
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

const acceptView = (plainRemovals: string[] = [], merges: string[] = []): EjesAcceptView => ({
  keys: { splits: [], plainRemovals, merges, twinRemovals: [] },
  pointChoices: [],
  onChange: () => undefined,
  onPointChoicesChange: () => undefined,
  twinPicks: [],
  onTwinPickChange: () => undefined,
  canAnalyzeWithPicks: false,
  onAnalyzeWithPicks: () => undefined,
});

const ROW_COLUMNS: TableColumn<{ ref: string }>[] = [{ header: "reftramo", cell: (row) => row.ref }];

describe("EjesAcceptToolbar (EJ-24)", () => {
  const toolbarOf = (overrides: Partial<React.ComponentProps<typeof EjesAcceptToolbar>> = {}): string =>
    renderToStaticMarkup(
      React.createElement(EjesAcceptToolbar, {
        listed: 2,
        total: 2,
        canAcceptAll: true,
        canRejectAll: true,
        capped: false,
        onAcceptAll: () => undefined,
        onRejectAll: () => undefined,
        ...overrides,
      })
    );

  it("should render 'Aceptar todos' and 'Rechazar todos' as the bulk actions of one list", () => {
    const out = toolbarOf();

    expect(out).toContain(EJES_ACCEPT_TEXT.ACCEPT_ALL);
    expect(out).toContain(EJES_ACCEPT_TEXT.REJECT_ALL);
  });

  it("should disable 'Aceptar todos' when every listed row is already accepted", () => {
    const out = toolbarOf({ canAcceptAll: false });

    expect(out.indexOf("disabled")).toBeGreaterThan(-1);
    expect(out.slice(0, out.indexOf(EJES_ACCEPT_TEXT.ACCEPT_ALL))).toMatch(/disabled/);
  });

  it("should show the incomplete-list note with the listed and total counts when the list holds fewer rows than the analysis counted", () => {
    const out = toolbarOf({ listed: 3, total: 9 });

    expect(out).toContain(incompleteListTextOf(3, 9));
    expect(out).toContain("Aceptar todos actúa solo sobre los listados.");
  });

  it("should omit the incomplete-list note when every counted row is listed", () => {
    expect(toolbarOf({ listed: 2, total: 2 })).not.toContain("Lista incompleta");
  });

  it("should show the request-limit note only when the accept would pass ACCEPTED_KEYS_LIMIT", () => {
    expect(toolbarOf({ capped: true })).toContain(`${ACCEPTED_KEYS_LIMIT} tramos aceptados`);
    expect(toolbarOf({ capped: false })).not.toContain("tramos aceptados en esta lista");
  });
});

describe("EjesAcceptableRows (EJ-24)", () => {
  const rowsOut = (accept: EjesAcceptView, rows: Array<{ ref: string }>, total = rows.length): string =>
    renderToStaticMarkup(
      React.createElement(EjesAcceptableRows<{ ref: string }>, {
        list: EjesAcceptList.PLAIN_REMOVALS,
        rows,
        total,
        columns: ROW_COLUMNS,
        rowKey: (row) => row.ref,
        accept,
      })
    );

  it("should show 'Rechazar' on an accepted row and 'Aceptar' on a pending one, with the column header", () => {
    const out = rowsOut(acceptView(["5001"]), [{ ref: "5001" }, { ref: "5002" }]);

    expect(out).toContain(EJES_ACCEPT_TEXT.COLUMN);
    expect(out.split(`<span>${EJES_ACCEPT_TEXT.REJECT}</span>`).length - 1).toBe(1);
    expect(out.split(`<span>${EJES_ACCEPT_TEXT.ACCEPT}</span>`).length - 1).toBe(1);
  });

  it("should show 'Aceptar' on every row when nothing is accepted", () => {
    const out = rowsOut(acceptView(), [{ ref: "5001" }, { ref: "5002" }]);

    expect(out.split(`<span>${EJES_ACCEPT_TEXT.ACCEPT}</span>`).length - 1).toBe(2);
    expect(out).not.toContain(`<span>${EJES_ACCEPT_TEXT.REJECT}</span>`);
  });

  it("should carry the list's accepted keys only, not the keys of another list", () => {
    const out = rowsOut(renderAcceptFor(["6103"]), [{ ref: "5001" }]);

    expect(out).not.toContain(`<span>${EJES_ACCEPT_TEXT.REJECT}</span>`);
  });

  it("should omit the incomplete-list note when the rows are the whole list", () => {
    expect(rowsOut(acceptView(), [{ ref: "5001" }], 1)).not.toContain("Lista incompleta");
  });

  it("should show the incomplete-list note when the analysis counted more rows than the list holds", () => {
    expect(rowsOut(acceptView(), [{ ref: "5001" }], 4)).toContain(incompleteListTextOf(1, 4));
  });
});

function renderAcceptFor(merges: string[]): EjesAcceptView {
  return {
    keys: { splits: [], plainRemovals: [], merges, twinRemovals: [] },
    pointChoices: [],
    onChange: () => undefined,
    onPointChoicesChange: () => undefined,
    twinPicks: [],
    onTwinPickChange: () => undefined,
    canAnalyzeWithPicks: false,
    onAnalyzeWithPicks: () => undefined,
  };
}

describe("accept controls on the Resultado step (EJ-24)", () => {
  it("should show the accept controls, the accepted badge and the split note on a dry-run result", () => {
    const out = doneStep(resultOf(), acceptView(["5001"], []));

    expect(out).toContain(EJES_ACCEPT_TEXT.ACCEPT_ALL);
    expect(out).toContain(EJES_ACCEPT_TEXT.REJECT_ALL);
    expect(out).toContain(acceptedCountTextOf(1, 1));
    expect(out).toContain(acceptedCountTextOf(0, 1));
    expect(out).toContain(EJES_ACCEPT_TEXT.SPLIT_NOTE);
  });

  it("should show no accept control, no badge and no split note on a real-run result, even when accept is passed", () => {
    const realRun = resultOf({ dryRun: false, targetModified: true, load: undefined } as Partial<EjesResult>);
    const out = doneStep(realRun, acceptView(["5001"], ["6103"]));

    expect(out).not.toContain(EJES_ACCEPT_TEXT.ACCEPT_ALL);
    expect(out).not.toContain(EJES_ACCEPT_TEXT.REJECT_ALL);
    expect(out).not.toContain(EJES_ACCEPT_TEXT.SPLIT_NOTE);
    expect(out).not.toContain("aceptados de");
  });

  it("should still list the merges and removals of a real-run result, read-only", () => {
    const realRun = resultOf({ dryRun: false, targetModified: true, load: undefined } as Partial<EjesResult>);
    const out = doneStep(realRun);

    expect(out).toContain("6103");
    expect(out).toContain("5001");
  });

  it("should show no accept control on a dry-run result when no accept view is wired (read-only)", () => {
    expect(doneStep(resultOf())).not.toContain(EJES_ACCEPT_TEXT.ACCEPT_ALL);
  });
});
