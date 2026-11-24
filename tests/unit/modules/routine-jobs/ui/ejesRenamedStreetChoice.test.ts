import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { EjesRenamedStreetRow } from "@/modules/routine-jobs/jobs/ejes-calles/types";
import { EjesAcceptableRows } from "@/modules/routine-jobs/ui/ejes-calles/EjesAcceptableRows";
import type { EjesAcceptButtonProps } from "@/modules/routine-jobs/ui/ejes-calles/EjesAcceptButton";
import {
  EjesAcceptList,
  acceptKeysOf,
  acceptanceAfter,
  acceptedKeysOfList,
  acceptedRequestOf,
  renameChoiceAfter,
  renameChoicesOf,
  type EjesAcceptKeys,
  type EjesAcceptView,
} from "@/modules/routine-jobs/ui/ejes-calles/ejesAccept";
import { RENAMED_NEW_NAME_HEADER } from "@/modules/routine-jobs/ui/ejes-calles/ejesReportColumns";
import { renamedStreetKeyOf, type EjesRenamedNameChoice } from "@/modules/routine-jobs/ui/ejes-calles/ejesRenamedStreetsView";
import { renamedStreetColumnsOf, renamedToggleDisabledOf } from "@/modules/routine-jobs/ui/ejes-calles/renamedStreetColumns";
import {
  ejesWizardReducer,
  EjesStep,
  initialEjesWizardState,
  type EjesWizardAction,
  type EjesWizardState,
} from "@/modules/routine-jobs/ui/ejes-calles/ejesCallesWizardState";
import type { TableColumn } from "@/modules/routine-jobs/ui/shared/ReportParts";

const KEY = "key-1";
const CHOICE_TEXT = "Elegir nombre…";

const renamed = (overrides: Partial<EjesRenamedStreetRow> = {}): EjesRenamedStreetRow => ({
  idcalle: "101",
  currentNames: "CALLE VIEJA",
  newName: "CALLE NUEVA",
  sections: 2,
  ways: 3,
  multiName: false,
  ...overrides,
});

const SINGLE_ROW = renamed({ idcalle: "101" });
const CHOSEN_ROW = renamed({
  idcalle: "103",
  currentNames: "CALLE VIEJA TRES",
  newName: "CALLE UNO",
  names: ["CALLE UNO", "CALLE DOS"],
  multiName: true,
});
const OPEN_ROW = renamed({
  idcalle: "104",
  currentNames: "CALLE VIEJA CUATRO",
  newName: "CALLE TRES",
  names: ["CALLE TRES", "CALLE CUATRO"],
  multiName: true,
});

const NO_KEYS: EjesAcceptKeys = { splits: [], plainRemovals: [], merges: [], twinRemovals: [] };

const viewOf = (
  renamedStreets: string[] = [],
  renameChoices: EjesRenamedNameChoice[] = [],
  onChange = vi.fn(),
  onRenameChoiceChange = vi.fn()
): EjesAcceptView => ({
  keys: { ...NO_KEYS, renamedStreets },
  renameChoices,
  onRenameChoiceChange,
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

const listTreeOf = (rows: EjesRenamedStreetRow[], accept: EjesAcceptView) => {
  const tree = EjesAcceptableRows<EjesRenamedStreetRow>({
    list: EjesAcceptList.RENAMED_STREETS,
    rows,
    total: rows.length,
    columns: renamedStreetColumnsOf(accept),
    rowKey: renamedStreetKeyOf,
    toggleDisabled: renamedToggleDisabledOf(accept),
    accept,
  });
  const [toolbar, table] = tree.props.children as [React.ReactElement, React.ReactElement];
  return {
    toolbar: toolbar.props as { canAcceptAll: boolean; canRejectAll: boolean; onAcceptAll: () => void },
    columns: (table.props as { columns: TableColumn<EjesRenamedStreetRow>[] }).columns,
  };
};

const acceptCellOf = (rows: EjesRenamedStreetRow[], accept: EjesAcceptView, row: EjesRenamedStreetRow): React.ReactElement<EjesAcceptButtonProps> => {
  const { columns } = listTreeOf(rows, accept);
  return columns[columns.length - 1].cell(row) as React.ReactElement<EjesAcceptButtonProps>;
};

const nameCellOf = (row: EjesRenamedStreetRow, accept: EjesAcceptView): React.ReactNode => {
  const column = renamedStreetColumnsOf(accept).find((candidate) => candidate.header === RENAMED_NEW_NAME_HEADER);
  if (column === undefined) throw new Error("the renamed streets list has no new name column");
  return column.cell(row);
};

interface SelectLike {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}

/** The select of a multi-name cell, read from the element tree the cell component builds (it holds no hooks, so it is called directly). */
const selectOf = (row: EjesRenamedStreetRow, accept: EjesAcceptView): SelectLike => {
  const cell = nameCellOf(row, accept) as React.ReactElement;
  const render = cell.type as (props: unknown) => React.ReactElement<{ children: React.ReactElement<SelectLike> }>;
  return render(cell.props).props.children.props;
};

describe("renamed streets with several names (EJL-31)", () => {
  describe("new name cell", () => {
    it("should show the single name of a one-name row as text, without a select", () => {
      const out = renderToStaticMarkup(React.createElement(React.Fragment, null, nameCellOf(SINGLE_ROW, viewOf())));

      expect(out).toContain("CALLE NUEVA");
      expect(out).not.toContain("<select");
    });

    it("should render a select with the choose-a-name option and every name of a several-name row", () => {
      const out = renderToStaticMarkup(React.createElement(React.Fragment, null, nameCellOf(CHOSEN_ROW, viewOf())));

      expect(out).toContain("<select");
      expect(out).toMatch(new RegExp(`<option value=""( selected="")?>${CHOICE_TEXT}</option>`));
      expect(out).toContain(">CALLE UNO</option>");
      expect(out).toContain(">CALLE DOS</option>");
    });

    it("should list the choose-a-name option first, then each name in file order", () => {
      expect(selectOf(OPEN_ROW, viewOf()).options).toEqual([
        { value: "", label: CHOICE_TEXT },
        { value: "CALLE TRES", label: "CALLE TRES" },
        { value: "CALLE CUATRO", label: "CALLE CUATRO" },
      ]);
    });

    it("should select the placeholder option when the several-name row has no chosen name", () => {
      expect(selectOf(OPEN_ROW, viewOf()).value).toBe("");
    });

    it("should select the chosen name when the several-name row has one", () => {
      expect(selectOf(CHOSEN_ROW, viewOf([], [{ idcalle: "103", name: "CALLE DOS" }])).value).toBe("CALLE DOS");
    });

    it("should report the chosen name, without accepting the row, when a name is picked", () => {
      const onChange = vi.fn();
      const onRenameChoiceChange = vi.fn();
      const accept = viewOf([], [], onChange, onRenameChoiceChange);

      selectOf(OPEN_ROW, accept).onChange("CALLE CUATRO");

      expect(onRenameChoiceChange).toHaveBeenCalledWith({ idcalle: "104", name: "CALLE CUATRO" });
      expect(onChange).not.toHaveBeenCalled();
    });

    it("should report a cleared name when the placeholder option is picked again", () => {
      const onRenameChoiceChange = vi.fn();

      selectOf(CHOSEN_ROW, viewOf([], [{ idcalle: "103", name: "CALLE DOS" }], vi.fn(), onRenameChoiceChange)).onChange("");

      expect(onRenameChoiceChange).toHaveBeenCalledWith({ idcalle: "103", name: null });
    });
  });

  describe("accept toggle", () => {
    it("should disable the toggle of a several-name row until a name is chosen", () => {
      const button = acceptCellOf([OPEN_ROW], viewOf(), OPEN_ROW);

      expect(button.props.accepted).toBe(false);
      expect(button.props.disabled).toBe(true);
    });

    it("should enable the toggle of a several-name row once a name is chosen", () => {
      const accept = viewOf([], [{ idcalle: "104", name: "CALLE TRES" }]);
      const button = acceptCellOf([OPEN_ROW], accept, OPEN_ROW);

      expect(button.props.disabled).toBe(false);
    });

    it("should leave the toggle of a one-name row enabled", () => {
      const button = acceptCellOf([SINGLE_ROW], viewOf(), SINGLE_ROW);

      expect(button.props.disabled).toBe(false);
    });

    it("should accept a several-name row with a chosen name when its toggle is pressed", () => {
      const onChange = vi.fn();
      const accept = viewOf([], [{ idcalle: "103", name: "CALLE DOS" }], onChange);

      acceptCellOf([CHOSEN_ROW], accept, CHOSEN_ROW).props.onToggle();

      expect(onChange).toHaveBeenCalledWith({ list: EjesAcceptList.RENAMED_STREETS, keys: ["103"], accepted: true });
    });

    it("should keep an accepted several-name row enabled so it can be rejected", () => {
      const accept = viewOf(["103"], [{ idcalle: "103", name: "CALLE DOS" }]);
      const button = acceptCellOf([CHOSEN_ROW], accept, CHOSEN_ROW);

      expect(button.props.accepted).toBe(true);
      expect(button.props.disabled).toBe(false);
    });
  });

  describe("bulk accept", () => {
    it("should accept the one-name rows and the chosen several-name rows, and leave the unchosen ones, on 'Aceptar todos'", () => {
      const onChange = vi.fn();
      const accept = viewOf([], [{ idcalle: "103", name: "CALLE DOS" }], onChange);

      listTreeOf([SINGLE_ROW, CHOSEN_ROW, OPEN_ROW], accept).toolbar.onAcceptAll();

      expect(onChange).toHaveBeenCalledWith({ list: EjesAcceptList.RENAMED_STREETS, keys: ["101", "103"], accepted: true });
    });

    it("should disable 'Aceptar todos' when every row is a several-name row with no chosen name", () => {
      const { toolbar } = listTreeOf([OPEN_ROW], viewOf());

      expect(toolbar.canAcceptAll).toBe(false);
    });
  });

  describe("request", () => {
    it("should send the one-name row as { idcalle } and the chosen several-name row as { idcalle, name }", () => {
      const request = acceptedRequestOf(
        { ...NO_KEYS, renamedStreets: ["101", "103"] },
        [],
        [],
        [],
        { rows: [SINGLE_ROW, CHOSEN_ROW], choices: [{ idcalle: "103", name: "CALLE DOS" }] }
      );

      expect(request.renamedStreets).toEqual([{ idcalle: "101" }, { idcalle: "103", name: "CALLE DOS" }]);
    });

    it("should never send an accepted several-name row that has no chosen name", () => {
      const request = acceptedRequestOf(
        { ...NO_KEYS, renamedStreets: ["101", "104"] },
        [],
        [],
        [],
        { rows: [SINGLE_ROW, OPEN_ROW], choices: [] }
      );

      expect(request.renamedStreets).toEqual([{ idcalle: "101" }]);
    });

    it("should omit the renamedStreets key when the only accepted row is a several-name row with no chosen name", () => {
      const request = acceptedRequestOf(
        { ...NO_KEYS, renamedStreets: ["104"] },
        [],
        [],
        [],
        { rows: [OPEN_ROW], choices: [] }
      );

      expect(Object.keys(request)).not.toContain("renamedStreets");
    });
  });

  describe("acceptance state", () => {
    const acceptedWithChoice = () =>
      acceptanceAfter(renameChoiceAfter(null, KEY, { idcalle: "103", name: "CALLE DOS" }), KEY, {
        list: EjesAcceptList.RENAMED_STREETS,
        keys: ["103"],
        accepted: true,
      });

    it("should not accept a several-name street when its name is chosen", () => {
      const next = renameChoiceAfter(null, KEY, { idcalle: "103", name: "CALLE DOS" });

      expect(acceptedKeysOfList(acceptKeysOf(next, KEY), EjesAcceptList.RENAMED_STREETS)).toEqual([]);
      expect(renameChoicesOf(next, KEY)).toEqual([{ idcalle: "103", name: "CALLE DOS" }]);
    });

    it("should keep the chosen name when the street is unaccepted", () => {
      const next = acceptanceAfter(acceptedWithChoice(), KEY, { list: EjesAcceptList.RENAMED_STREETS, keys: ["103"], accepted: false });

      expect(acceptedKeysOfList(acceptKeysOf(next, KEY), EjesAcceptList.RENAMED_STREETS)).toEqual([]);
      expect(renameChoicesOf(next, KEY)).toEqual([{ idcalle: "103", name: "CALLE DOS" }]);
    });

    it("should keep the street accepted when its chosen name changes", () => {
      const next = renameChoiceAfter(acceptedWithChoice(), KEY, { idcalle: "103", name: "CALLE UNO" });

      expect(acceptedKeysOfList(acceptKeysOf(next, KEY), EjesAcceptList.RENAMED_STREETS)).toEqual(["103"]);
      expect(renameChoicesOf(next, KEY)).toEqual([{ idcalle: "103", name: "CALLE UNO" }]);
    });

    it("should unaccept the street and drop its name when the choice is cleared", () => {
      const next = renameChoiceAfter(acceptedWithChoice(), KEY, { idcalle: "103", name: null });

      expect(acceptedKeysOfList(acceptKeysOf(next, KEY), EjesAcceptList.RENAMED_STREETS)).toEqual([]);
      expect(renameChoicesOf(next, KEY)).toEqual([]);
    });
  });

  describe("renameChoiceChanged reducer action", () => {
    const stateWith = (overrides: Partial<EjesWizardState> = {}): EjesWizardState => ({ ...initialEjesWizardState(), step: EjesStep.RESULT, ...overrides });
    const reduce = (state: EjesWizardState, ...actions: EjesWizardAction[]): EjesWizardState => actions.reduce(ejesWizardReducer, state);
    const choose = (analysisKey: string, idcalle: string, name: string | null): EjesWizardAction => ({
      type: "renameChoiceChanged",
      analysisKey,
      idcalle,
      name,
    });
    const acceptRenamed = (analysisKey: string, keys: string[]): EjesWizardAction => ({
      type: "acceptChanged",
      analysisKey,
      change: { list: EjesAcceptList.RENAMED_STREETS, keys, accepted: true },
    });

    it("should store the chosen name on the acceptance of the same analysis without accepting the street", () => {
      const state = reduce(stateWith(), choose(KEY, "103", "CALLE DOS"));

      expect(state.acceptance?.analysisKey).toBe(KEY);
      expect(acceptedKeysOfList(acceptKeysOf(state.acceptance, KEY), EjesAcceptList.RENAMED_STREETS)).toEqual([]);
      expect(renameChoicesOf(state.acceptance, KEY)).toEqual([{ idcalle: "103", name: "CALLE DOS" }]);
    });

    it("should keep the accepted streets when a name is chosen for another street", () => {
      const state = reduce(stateWith(), acceptRenamed(KEY, ["101"]), choose(KEY, "103", "CALLE DOS"));

      expect(acceptedKeysOfList(acceptKeysOf(state.acceptance, KEY), EjesAcceptList.RENAMED_STREETS)).toEqual(["101"]);
    });

    it("should unaccept the street when its name is cleared through the reducer", () => {
      const state = reduce(stateWith(), choose(KEY, "103", "CALLE DOS"), acceptRenamed(KEY, ["103"]), choose(KEY, "103", null));

      expect(acceptedKeysOfList(acceptKeysOf(state.acceptance, KEY), EjesAcceptList.RENAMED_STREETS)).toEqual([]);
      expect(renameChoicesOf(state.acceptance, KEY)).toEqual([]);
    });

    it("should drop the accepted streets and the name choices when the analysis changes", () => {
      const first = reduce(stateWith(), choose(KEY, "103", "CALLE DOS"), acceptRenamed(KEY, ["103"]));
      const second = reduce(first, choose("key-2", "101", "CALLE NUEVA OTRA"));

      expect(second.acceptance?.analysisKey).toBe("key-2");
      expect(renameChoicesOf(second.acceptance, "key-2")).toEqual([{ idcalle: "101", name: "CALLE NUEVA OTRA" }]);
      expect(acceptedKeysOfList(acceptKeysOf(second.acceptance, "key-2"), EjesAcceptList.RENAMED_STREETS)).toEqual([]);
    });

    it("should drop the acceptance and the name choices when the department changes", () => {
      const state = reduce(
        stateWith(),
        choose(KEY, "103", "CALLE DOS"),
        acceptRenamed(KEY, ["103"]),
        { type: "departmentChanged", department: "CANELONES" }
      );

      expect(state.acceptance).toBeNull();
      expect(renameChoicesOf(state.acceptance, KEY)).toEqual([]);
    });
  });
});
