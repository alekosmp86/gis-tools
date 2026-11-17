import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { EjesBackup, EjesLoadReport, EjesResult, EjesSkippedRow } from "@/modules/routine-jobs/jobs/ejes-calles/types";
import { EjesLoadResult } from "@/modules/routine-jobs/ui/ejes-calles/EjesLoadResult";
import type { EjesRunSnapshot } from "@/modules/routine-jobs/ui/shared/ejesCallesRunStore";
import { RunPhase } from "@/modules/routine-jobs/ui/shared/jobRunStore";
import { EjesResultStep, type EjesResultStepProps } from "@/modules/routine-jobs/ui/ejes-calles/steps/EjesResultStep";
import {
  EJES_LOAD_DONE_BANNER,
  EJES_LOAD_SKIPPED_BY_REASON_TITLE,
  EJES_LOAD_SKIPPED_TITLE,
  EJES_LOAD_SURPLUS_TITLE,
  EJES_LOAD_TITLE,
  EJES_LOAD_UNKNOWN_BANNER,
} from "@/modules/routine-jobs/ui/ejes-calles/ejesLoadTexts";

const REPORT_MARKER = "Todos los indicadores";
const BACKUP_TITLE = "Respaldo para revertir";
const NEXT_STEP_TITLE = "Siguiente paso sugerido";
const COMMIT_ERROR = "No se pudo cerrar la transacción: fallo de red ***";

const COUNTS = {
  newSections: 5,
  unchanged: 80,
  attr: 2,
  geom: 3,
  both: 1,
  removed: 4,
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
  renumberedPoints: 5,
  renumberSkipped: 1,
};

const LOAD_COUNTS = {
  inserted: 3,
  updated: 2,
  renumbered: 1,
  renumberSkipped: 0,
  removed: 0,
  merged: 0,
  deleted: 0,
  waysCreated: 4,
  pointsMoved: 9,
  topologyAssigned: 0,
  verticesCreated: 0,
  verticesDeleted: 0,
  splitsApplied: 0,
};

const BACKUP: EjesBackup = {
  token: "tok-render",
  fileName: "ejes-revert-carto-road_section-20260101-100000-000.sql.gz",
  bytes: 2048,
  counts: { updated: 2, inserted: 3, ways: 4, masters: 3, pointsMoved: 9, deleted: 0 },
};

const SKIPPED_RENUMBER: EjesSkippedRow = {
  kind: "renumber",
  refs: ["3001", "3002"],
  newRefs: [],
  idcalle: "5",
  points: 2,
  reason: "not_single_copy",
};

const loadOf = (overrides: Partial<EjesLoadReport> = {}): EjesLoadReport => ({
  counts: { ...LOAD_COUNTS },
  surplus: [],
  surplusTotal: 0,
  renumbered: [],
  skipped: [],
  skippedTotal: 0,
  skippedByReason: [],
  ...overrides,
});

/** A full dry-run style result, so the report below the load block has every list it reads. */
const resultOf = (overrides: Partial<EjesResult> = {}): EjesResult =>
  ({
    dryRun: false,
    targetModified: true,
    outcomeUnknown: false,
    staging: {
      rows: 100,
      distinctRefs: 98,
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
    fingerprint: { rows: 100, digest: "0123456789abcdef0123456789abcdef" },
    cloc: { withLocality: 6, onlyDepartment: 2, withoutCode: 0 },
    splits: [],
    merges: [],
    plainRemovals: [],
    newStreets: [],
    twins: [],
    renumbered: [],
    renumberSkipped: [],
    attrChanges: [],
    blockers: [],
    privilegeInfo: [],
    tables: {},
    stepTimings: [{ label: "a", ms: 1500 }],
    load: loadOf(),
    ...overrides,
  }) as unknown as EjesResult;

const html = (node: React.ReactElement): string => renderToStaticMarkup(node);

const loadHtml = (result: EjesResult, load: EjesLoadReport): string => html(React.createElement(EjesLoadResult, { result, load }));

const doneStep = (result: EjesResult | undefined, overrides: Partial<EjesResultStepProps> = {}): string => {
  const snapshot = { phase: RunPhase.DONE, job: result === undefined ? undefined : { state: "DONE", result }, plan: undefined } as unknown as EjesRunSnapshot;
  const props: EjesResultStepProps = {
    snapshot,
    nowMs: 0,
    mapBase: null,
    canLoad: false,
    onLoad: () => undefined,
    onNewRun: () => undefined,
    onBackToReview: () => undefined,
    ...overrides,
  };
  return html(React.createElement(EjesResultStep, props));
};

describe("EjesLoadResult (EJL-13, EJ-24)", () => {
  it("should render the title, the outcome banner and the applied counts", () => {
    const out = loadHtml(resultOf(), loadOf());

    expect(out).toContain(EJES_LOAD_TITLE);
    expect(out).toContain(EJES_LOAD_DONE_BANNER);
    expect(out).toContain("Tramos insertados");
    expect(out).toContain("Puntos de acceso movidos");
  });

  it("should render the title before the outcome banner and before the commit error alert", () => {
    const out = loadHtml(resultOf({ commitError: COMMIT_ERROR, outcomeUnknown: true, targetModified: false }), loadOf());

    expect(out.indexOf(EJES_LOAD_TITLE)).toBeGreaterThanOrEqual(0);
    expect(out.indexOf(EJES_LOAD_TITLE)).toBeLessThan(out.indexOf(EJES_LOAD_UNKNOWN_BANNER));
    expect(out.indexOf(EJES_LOAD_TITLE)).toBeLessThan(out.indexOf(COMMIT_ERROR));
  });

  it("should render the title before the confirmed banner when the tables were modified", () => {
    const out = loadHtml(resultOf(), loadOf());

    expect(out.indexOf(EJES_LOAD_TITLE)).toBeLessThan(out.indexOf(EJES_LOAD_DONE_BANNER));
  });

  it("should render the COMMIT-not-confirmed banner, and not the confirmed one, when the outcome is unknown", () => {
    const out = loadHtml(resultOf({ targetModified: false, outcomeUnknown: true }), loadOf());

    expect(out).toContain(EJES_LOAD_UNKNOWN_BANNER);
    expect(out).not.toContain(EJES_LOAD_DONE_BANNER);
  });

  it("should render the commit error in an alert when COMMIT failed, with the password already scrubbed", () => {
    const out = loadHtml(resultOf({ commitError: COMMIT_ERROR, outcomeUnknown: true, targetModified: false }), loadOf());

    expect(out).toContain(COMMIT_ERROR);
    expect(out).toContain("***");
  });

  it("should render no commit error text when COMMIT did not fail", () => {
    expect(loadHtml(resultOf(), loadOf())).not.toContain("fallo de red");
  });

  it("should render the skipped list with its count and each renumber with both refs and its reason", () => {
    const out = loadHtml(resultOf(), loadOf({ skipped: [SKIPPED_RENUMBER], skippedTotal: 1, skippedByReason: [{ reason: "not_single_copy", count: 1 }] }));

    expect(out).toContain(`${EJES_LOAD_SKIPPED_TITLE} (1)`);
    expect(out).toContain("3001 / 3002");
    expect(out).toContain("El reftramo nuevo no tiene exactamente una copia");
  });

  it("should render the total in the skipped header and the reason counts over every row, not only the listed ones", () => {
    const out = loadHtml(
      resultOf(),
      loadOf({
        skipped: [SKIPPED_RENUMBER],
        skippedTotal: 1200,
        skippedByReason: [
          { reason: "review_required", count: 1100 },
          { reason: "not_single_copy", count: 100 },
        ],
      })
    );

    expect(out).toContain(`${EJES_LOAD_SKIPPED_TITLE} (1200)`);
    expect(out).toContain(EJES_LOAD_SKIPPED_BY_REASON_TITLE);
    expect(out).toContain("Puntos de acceso sin destino automático: requiere revisión");
  });

  it("should render the cap note with the listed and total counts when the list holds fewer rows than the total", () => {
    const out = loadHtml(resultOf(), loadOf({ skipped: [SKIPPED_RENUMBER], skippedTotal: 1200, skippedByReason: [] }));

    expect(out).toContain("Primeras 1 de 1200 filas omitidas. Los conteos por motivo cubren todas.");
  });

  it("should omit the cap note when every skipped row is listed", () => {
    const out = loadHtml(resultOf(), loadOf({ skipped: [SKIPPED_RENUMBER], skippedTotal: 1, skippedByReason: [] }));

    expect(out).not.toContain("filas omitidas");
  });

  it("should omit the skipped list when nothing was held back", () => {
    expect(loadHtml(resultOf(), loadOf())).not.toContain(EJES_LOAD_SKIPPED_TITLE);
  });

  it("should render the surplus list with its total, and omit it when there is no surplus", () => {
    const withSurplus = loadHtml(resultOf(), loadOf({ surplus: [{ ref: "4001", id: "12", points: 4 }], surplusTotal: 1 }));

    expect(withSurplus).toContain(`${EJES_LOAD_SURPLUS_TITLE} (1)`);
    expect(withSurplus).toContain("4001");
    expect(loadHtml(resultOf(), loadOf())).not.toContain(EJES_LOAD_SURPLUS_TITLE);
  });

  it("should render the revert backup with its file name and download button when the load wrote one", () => {
    const out = loadHtml(resultOf(), loadOf({ backup: BACKUP }));

    expect(out).toContain(BACKUP_TITLE);
    expect(out).toContain(BACKUP.fileName);
    expect(out).toContain("Descargar respaldo");
    expect(out).toContain("Direcciones maestras insertadas");
  });

  it("should omit the backup section when the load wrote no backup", () => {
    const out = loadHtml(resultOf(), loadOf({ backup: undefined }));

    expect(out).not.toContain(BACKUP_TITLE);
    expect(out).not.toContain("Descargar respaldo");
  });

  it("should render the suggested next step with its statement when the result has one", () => {
    const nextStep = { text: "Las vistas materializadas no se actualizan solas.", statement: "REFRESH MATERIALIZED VIEW carto.mv_road_section;" };
    const out = loadHtml(resultOf({ nextStep }), loadOf());

    expect(out).toContain(NEXT_STEP_TITLE);
    expect(out).toContain(nextStep.text);
    expect(out).toContain(nextStep.statement);
  });

  it("should omit the next step when the result has none", () => {
    expect(loadHtml(resultOf(), loadOf())).not.toContain(NEXT_STEP_TITLE);
  });
});

describe("EjesResultStep shows the load block before the report (EJ-24)", () => {
  it("should render the Resultado de la carga block before the report when the finished run carries a load", () => {
    const out = doneStep(resultOf());

    expect(out).toContain(EJES_LOAD_TITLE);
    expect(out.indexOf(EJES_LOAD_TITLE)).toBeLessThan(out.indexOf(REPORT_MARKER));
  });

  it("should render no load block when the finished run is an analysis (dry run), which shows only the report", () => {
    const out = doneStep(resultOf({ dryRun: true, targetModified: false, load: undefined }));

    expect(out).not.toContain(EJES_LOAD_TITLE);
    expect(out).toContain(REPORT_MARKER);
  });

  it("should render the commit error alert inside the load block", () => {
    const out = doneStep(resultOf({ commitError: COMMIT_ERROR, outcomeUnknown: true, targetModified: false }));

    expect(out).toContain(COMMIT_ERROR);
    expect(out.indexOf(COMMIT_ERROR)).toBeLessThan(out.indexOf(REPORT_MARKER));
  });

  it("should render the backup section inside the load block when the load wrote one", () => {
    const out = doneStep(resultOf({ load: loadOf({ backup: BACKUP }) }));

    expect(out).toContain(BACKUP_TITLE);
    expect(out.indexOf(EJES_LOAD_TITLE)).toBeLessThan(out.indexOf(BACKUP_TITLE));
  });

  it("should keep the report and the navigation actions when the load block is shown", () => {
    const out = doneStep(resultOf());

    expect(out).toContain(REPORT_MARKER);
    expect(out).toContain("Nueva carga");
    expect(out).toContain("Volver a Revisar");
  });

  it("should not render the report's dry-run banner for a real run", () => {
    const out = doneStep(resultOf());

    expect(out).not.toContain("Análisis: no se modificó ninguna tabla.");
  });

  it("should show no load block and no report while the run is still running", () => {
    const snapshot = { phase: RunPhase.RUNNING, job: undefined, plan: undefined } as unknown as EjesRunSnapshot;
    const out = html(
      React.createElement(EjesResultStep, {
        snapshot,
        nowMs: 0,
        mapBase: null,
        canLoad: false,
        onLoad: () => undefined,
        onNewRun: () => undefined,
        onBackToReview: () => undefined,
      })
    );

    expect(out).not.toContain(EJES_LOAD_TITLE);
    expect(out).not.toContain(REPORT_MARKER);
  });
});
