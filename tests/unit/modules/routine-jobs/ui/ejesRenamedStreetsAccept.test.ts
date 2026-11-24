import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { EjesResult, EjesRenamedStreetRow } from "@/modules/routine-jobs/jobs/ejes-calles/types";
import { EjesAcceptableRows } from "@/modules/routine-jobs/ui/ejes-calles/EjesAcceptableRows";
import type { EjesAcceptButtonProps } from "@/modules/routine-jobs/ui/ejes-calles/EjesAcceptButton";
import {
  EjesAcceptList,
  acceptKeysOf,
  acceptanceAfter,
  acceptedKeysOfList,
  acceptedRequestOf,
  type EjesAcceptView,
} from "@/modules/routine-jobs/ui/ejes-calles/ejesAccept";
import { EJES_ACCEPT_TEXT, acceptedCountTextOf } from "@/modules/routine-jobs/ui/ejes-calles/ejesAcceptTexts";
import { EJES_LIST } from "@/modules/routine-jobs/ui/ejes-calles/ejesCallesListMeta";
import { buildEjesReportView } from "@/modules/routine-jobs/ui/ejes-calles/ejesCallesReportView";
import { EjesReportLists, type EjesReportListsProps } from "@/modules/routine-jobs/ui/ejes-calles/EjesReportLists";
import { RENAMED_STREET_COLUMNS } from "@/modules/routine-jobs/ui/ejes-calles/ejesReportColumns";
import { renamedStreetKeyOf, renamedStreetRowsOf } from "@/modules/routine-jobs/ui/ejes-calles/ejesRenamedStreetsView";
import { renamedToggleDisabledOf } from "@/modules/routine-jobs/ui/ejes-calles/renamedStreetColumns";
import type { TableColumn } from "@/modules/routine-jobs/ui/shared/ReportParts";

const renamed = (overrides: Partial<EjesRenamedStreetRow> = {}): EjesRenamedStreetRow => ({
  idcalle: "101",
  currentNames: "CALLE VIEJA",
  newName: "CALLE NUEVA",
  sections: 2,
  ways: 3,
  multiName: false,
  ...overrides,
});

const ROW_A = renamed({ idcalle: "101" });
const ROW_B = renamed({ idcalle: "102", currentNames: "OTRA VIEJA", newName: "OTRA NUEVA", sections: 1, ways: 1 });

const COUNTS = {
  newSections: 2,
  unchanged: 10,
  attr: 0,
  geom: 0,
  both: 0,
  removed: 0,
  splits: 0,
  replacements: 0,
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
  renumberSkipped: 0,
  renamedStreets: 2,
};

const STAGING = {
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
};

const resultOf = (overrides: Partial<EjesResult> = {}): EjesResult =>
  ({
    dryRun: true,
    targetModified: false,
    outcomeUnknown: false,
    staging: STAGING,
    counts: COUNTS,
    fingerprint: { rows: 4, digest: "0123456789abcdef0123456789abcdef" },
    cloc: { withLocality: 0, onlyDepartment: 0, withoutCode: 0 },
    splits: [],
    merges: [],
    plainRemovals: [],
    newStreets: [],
    twins: [],
    twinUndecided: [],
    geoTwins: [],
    renumbered: [],
    renumberSkipped: [],
    renumberDropped: [],
    keptByDiscarded: [],
    attrChanges: [],
    renamedStreets: [ROW_A, ROW_B],
    blockers: [],
    privilegeInfo: [],
    tables: {},
    stepTimings: [],
    ...overrides,
  }) as unknown as EjesResult;

const resultWithoutRenamedField = (): EjesResult => {
  const result = resultOf() as unknown as Record<string, unknown>;
  delete result.renamedStreets;
  return { ...result, counts: { ...COUNTS, renamedStreets: undefined } } as unknown as EjesResult;
};

const acceptViewOf = (renamedStreets: string[] = [], onChange = vi.fn()): EjesAcceptView => ({
  keys: { splits: [], plainRemovals: [], merges: [], twinRemovals: [], renamedStreets },
  pointChoices: [],
  onChange,
  onPointChoicesChange: () => undefined,
  twinPicks: [],
  onTwinPickChange: () => undefined,
  manualSplits: [],
  onManualSplitChange: () => undefined,
  canAnalyzeWithPicks: false,
  onAnalyzeWithPicks: () => undefined,
});

const listPropsOf = (rows: EjesRenamedStreetRow[], accept: EjesAcceptView) => ({
  list: EjesAcceptList.RENAMED_STREETS,
  rows,
  total: rows.length,
  columns: RENAMED_STREET_COLUMNS,
  rowKey: renamedStreetKeyOf,
  toggleDisabled: renamedToggleDisabledOf(accept),
  accept,
});

/** The toolbar and the rows of the acceptable-rows list, read from the element tree it returns. */
const listTreeOf = (rows: EjesRenamedStreetRow[], accept: EjesAcceptView) => {
  const tree = EjesAcceptableRows<EjesRenamedStreetRow>(listPropsOf(rows, accept));
  const [toolbar, table] = tree.props.children as [React.ReactElement, React.ReactElement];
  return { toolbar: toolbar.props as { canAcceptAll: boolean; canRejectAll: boolean; onAcceptAll: () => void; onRejectAll: () => void }, table: table.props as { columns: TableColumn<EjesRenamedStreetRow>[] } };
};

const acceptCellOf = (rows: EjesRenamedStreetRow[], accept: EjesAcceptView, row: EjesRenamedStreetRow): React.ReactNode => {
  const { table } = listTreeOf(rows, accept);
  return table.columns[table.columns.length - 1].cell(row);
};

const listedReportProps = (result: EjesResult, accept?: EjesAcceptView): EjesReportListsProps => {
  const view = buildEjesReportView(result);
  return {
    result,
    view,
    openLists: new Set([EJES_LIST.RENAMED_STREETS]),
    onToggle: () => undefined,
    onShowOnMap: () => undefined,
    subjects: { splits: [], merges: [], twinUndecided: [] },
    accept,
  };
};

describe("renamed streets acceptance (EJL-31)", () => {
  describe("acceptance keys", () => {
    it("should store an accepted renamed street under the renamedStreets key of its analysis", () => {
      const next = acceptanceAfter(null, "key-1", { list: EjesAcceptList.RENAMED_STREETS, keys: ["101"], accepted: true });

      expect(acceptedKeysOfList(acceptKeysOf(next, "key-1"), EjesAcceptList.RENAMED_STREETS)).toEqual(["101"]);
    });

    it("should keep the other accepted lists empty when only a renamed street is accepted", () => {
      const next = acceptanceAfter(null, "key-1", { list: EjesAcceptList.RENAMED_STREETS, keys: ["101"], accepted: true });

      expect(next.splits).toEqual([]);
      expect(next.plainRemovals).toEqual([]);
      expect(next.merges).toEqual([]);
      expect(next.twinRemovals).toEqual([]);
    });

    it("should add several renamed streets in order and never store one twice", () => {
      const once = acceptanceAfter(null, "key-1", { list: EjesAcceptList.RENAMED_STREETS, keys: ["101", "102"], accepted: true });
      const twice = acceptanceAfter(once, "key-1", { list: EjesAcceptList.RENAMED_STREETS, keys: ["102", "101"], accepted: true });

      expect(twice.renamedStreets).toEqual(["101", "102"]);
    });

    it("should reject one renamed street and keep the others accepted", () => {
      const accepted = acceptanceAfter(null, "key-1", { list: EjesAcceptList.RENAMED_STREETS, keys: ["101", "102"], accepted: true });
      const next = acceptanceAfter(accepted, "key-1", { list: EjesAcceptList.RENAMED_STREETS, keys: ["101"], accepted: false });

      expect(next.renamedStreets).toEqual(["102"]);
    });

    it("should reject every listed renamed street when the whole list is rejected", () => {
      const accepted = acceptanceAfter(null, "key-1", { list: EjesAcceptList.RENAMED_STREETS, keys: ["101", "102"], accepted: true });
      const next = acceptanceAfter(accepted, "key-1", { list: EjesAcceptList.RENAMED_STREETS, keys: ["101", "102"], accepted: false });

      expect(next.renamedStreets).toEqual([]);
    });

    it("should hold no renamed street for an acceptance made on another analysis", () => {
      const other = acceptanceAfter(null, "key-otro", { list: EjesAcceptList.RENAMED_STREETS, keys: ["101"], accepted: true });

      expect(acceptedKeysOfList(acceptKeysOf(other, "key-1"), EjesAcceptList.RENAMED_STREETS)).toEqual([]);
    });

    it("should hold no renamed street from an acceptance that predates the field", () => {
      const legacy = { analysisKey: "key-1", splits: [], plainRemovals: [], merges: [], twinRemovals: [], pointChoices: [] };

      expect(acceptedKeysOfList(acceptKeysOf(legacy, "key-1"), EjesAcceptList.RENAMED_STREETS)).toEqual([]);
    });
  });

  describe("request", () => {
    const keysWith = (renamedStreets: string[] | undefined) => ({
      splits: [],
      plainRemovals: [],
      merges: [],
      twinRemovals: [],
      ...(renamedStreets === undefined ? {} : { renamedStreets }),
    });

    it("should omit the renamedStreets key when the accepted list is empty", () => {
      const request = acceptedRequestOf(keysWith([]));

      expect(Object.keys(request)).not.toContain("renamedStreets");
    });

    it("should omit the renamedStreets key when the acceptance holds no such list", () => {
      const request = acceptedRequestOf(keysWith(undefined));

      expect(Object.keys(request)).not.toContain("renamedStreets");
    });
  });

  describe("toolbar and rows of the renamed streets list", () => {
    it("should accept every listed renamed street on 'Aceptar todos'", () => {
      const onChange = vi.fn();
      const accept = acceptViewOf([], onChange);
      const { toolbar } = listTreeOf([ROW_A, ROW_B], accept);

      toolbar.onAcceptAll();

      expect(onChange).toHaveBeenCalledWith({ list: EjesAcceptList.RENAMED_STREETS, keys: ["101", "102"], accepted: true });
    });

    it("should reject every listed renamed street on 'Rechazar todos'", () => {
      const onChange = vi.fn();
      const accept = acceptViewOf(["101", "102"], onChange);
      const { toolbar } = listTreeOf([ROW_A, ROW_B], accept);

      toolbar.onRejectAll();

      expect(onChange).toHaveBeenCalledWith({ list: EjesAcceptList.RENAMED_STREETS, keys: ["101", "102"], accepted: false });
    });

    it("should disable 'Rechazar todos' when no renamed street is accepted", () => {
      const { toolbar } = listTreeOf([ROW_A, ROW_B], acceptViewOf());

      expect(toolbar.canRejectAll).toBe(false);
    });

    it("should accept a pending renamed street through its row button", () => {
      const onChange = vi.fn();
      const accept = acceptViewOf([], onChange);
      const button = acceptCellOf([ROW_A, ROW_B], accept, ROW_A) as React.ReactElement<EjesAcceptButtonProps>;

      expect(button.props.accepted).toBe(false);
      button.props.onToggle();

      expect(onChange).toHaveBeenCalledWith({ list: EjesAcceptList.RENAMED_STREETS, keys: ["101"], accepted: true });
    });

    it("should reject an accepted renamed street through its row button", () => {
      const onChange = vi.fn();
      const accept = acceptViewOf(["101"], onChange);
      const button = acceptCellOf([ROW_A, ROW_B], accept, ROW_A) as React.ReactElement<EjesAcceptButtonProps>;

      expect(button.props.accepted).toBe(true);
      button.props.onToggle();

      expect(onChange).toHaveBeenCalledWith({ list: EjesAcceptList.RENAMED_STREETS, keys: ["101"], accepted: false });
    });

  });

  describe("rendered list, KPI and strip", () => {
    it("should render the renamed streets list with its five columns and the accept column", () => {
      const out = renderToStaticMarkup(React.createElement(EjesReportLists, listedReportProps(resultOf(), acceptViewOf(["101"]))));

      for (const header of ["Idcalle", "Nombre actual", "Nombre nuevo", "Tramos", "Filas de vía"]) expect(out).toContain(header);
      expect(out).toContain(EJES_ACCEPT_TEXT.COLUMN);
      expect(out).toContain("CALLE NUEVA");
    });

    it("should count only the acceptable renamed streets and the accepted ones in the badge", () => {
      const out = renderToStaticMarkup(React.createElement(EjesReportLists, listedReportProps(resultOf(), acceptViewOf(["101"]))));

      expect(out).toContain(acceptedCountTextOf(1, 2));
    });

    it("should render the renamed streets list read-only, without accept buttons, when no accept view is given", () => {
      const out = renderToStaticMarkup(React.createElement(EjesReportLists, listedReportProps(resultOf())));

      expect(out).toContain("Nombre nuevo");
      expect(out).not.toContain(EJES_ACCEPT_TEXT.ACCEPT_ALL);
    });

    it("should render no renamed streets section when the list holds no row", () => {
      const out = renderToStaticMarkup(React.createElement(EjesReportLists, listedReportProps(resultOf({ renamedStreets: [] }), acceptViewOf())));

      expect(out).not.toContain("Nombre nuevo");
      expect(out).not.toContain("Calles renombradas");
    });

    it("should show the 'Calles renombradas' KPI with the analysis count", () => {
      const view = buildEjesReportView(resultOf());
      const group = view.kpiGroups.find((entry) => entry.title === "Calles y localidades de los tramos nuevos o con trazado distinto");

      expect(group?.kpis).toContainEqual({ label: "Calles renombradas", value: 2 });
    });

    it("should show a strip item for the renamed streets with the listed row count, when rows exist", () => {
      const view = buildEjesReportView(resultOf());

      expect(view.strip).toContainEqual({
        key: EJES_LIST.RENAMED_STREETS,
        label: "Calles renombradas",
        value: 2,
        list: EJES_LIST.RENAMED_STREETS,
      });
    });

    it("should show no renamed streets strip item when the list holds no row", () => {
      const view = buildEjesReportView(resultOf({ renamedStreets: [] }));

      expect(view.strip.map((item) => item.key)).not.toContain(EJES_LIST.RENAMED_STREETS);
    });

    it("should read the renamed streets rows as an empty list when the result lacks the field", () => {
      expect(renamedStreetRowsOf(resultWithoutRenamedField())).toEqual([]);
    });

    it("should build the report view without a renamed streets item when the result lacks the field", () => {
      const view = buildEjesReportView(resultWithoutRenamedField());

      expect(view.strip.map((item) => item.key)).not.toContain(EJES_LIST.RENAMED_STREETS);
      expect(view.kpiGroups.flatMap((group) => group.kpis).find((kpi) => kpi.label === "Calles renombradas")?.value).toBe(0);
    });

    it("should render the report lists without crashing when the result lacks the field", () => {
      const out = renderToStaticMarkup(React.createElement(EjesReportLists, listedReportProps(resultWithoutRenamedField(), acceptViewOf())));

      expect(out).not.toContain("Nombre nuevo");
    });

    it("should list the renamed streets rows as the analysis holds them", () => {
      expect(renamedStreetRowsOf(resultOf())).toEqual([ROW_A, ROW_B]);
    });
  });
});
