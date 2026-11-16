import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EjesAcceptableRows } from "@/modules/routine-jobs/ui/EjesAcceptableRows";
import { EjesAcceptList, type EjesAcceptChange, type EjesAcceptView } from "@/modules/routine-jobs/ui/ejesAccept";
import { EJES_ACCEPT_TEXT } from "@/modules/routine-jobs/ui/ejesAcceptTexts";
import { REMOVAL_COLUMNS } from "@/modules/routine-jobs/ui/ejesReportColumns";
import { NO_REFTRAMO_TEXT } from "@/modules/routine-jobs/ui/ejesLoadTexts";
import type { EjesRemovalRow } from "@/modules/routine-jobs/jobs/ejes-calles/types";

/** The predicate EjesReportLists passes for plain removals: a row without a reftramo has no key to send. */
const acceptable = (row: EjesRemovalRow): boolean => row.ref !== "";

const NULL_ROW = { ref: "", idcalle: "5", points: 0 } as unknown as EjesRemovalRow;
const KEYED_ROW = { ref: "5001", idcalle: "5", points: 0 } as unknown as EjesRemovalRow;

function acceptViewRecording(changes: EjesAcceptChange[]): EjesAcceptView {
  return { keys: { plainRemovals: [], merges: [] }, onChange: (change) => changes.push(change) };
}

const listOf = (rows: EjesRemovalRow[], accept: EjesAcceptView): React.ReactElement =>
  EjesAcceptableRows<EjesRemovalRow>({
    list: EjesAcceptList.PLAIN_REMOVALS,
    rows,
    total: rows.length,
    columns: REMOVAL_COLUMNS,
    rowKey: (row) => row.ref,
    acceptable,
    accept,
  }) as React.ReactElement;

interface ToolbarProps {
  canAcceptAll: boolean;
  canRejectAll: boolean;
  onAcceptAll: () => void;
  onRejectAll: () => void;
}

/** The toolbar is the first child of the list; its bulk handlers are the only way the list reports a change. */
const toolbarOf = (element: React.ReactElement): React.ReactElement<ToolbarProps> =>
  (element.props as { children: React.ReactElement<ToolbarProps>[] }).children[0];

describe("plain removal without reftramo (EJ-24, F5)", () => {
  it("should show 'sin reftramo' in the reftramo column of a removal whose reftramo is empty", () => {
    const out = renderToStaticMarkup(listOf([NULL_ROW], acceptViewRecording([])));

    expect(out).toContain(NO_REFTRAMO_TEXT);
  });

  it("should show 'No aceptable: sin reftramo' in place of the accept button for that row", () => {
    const out = renderToStaticMarkup(listOf([NULL_ROW], acceptViewRecording([])));

    expect(out).toContain(EJES_ACCEPT_TEXT.NOT_ACCEPTABLE);
    expect(out).not.toContain(`<span>${EJES_ACCEPT_TEXT.ACCEPT}</span>`);
    expect(out).not.toContain(`<span>${EJES_ACCEPT_TEXT.REJECT}</span>`);
  });

  it("should give the accept button to a keyed removal next to the row without reftramo, and only to it", () => {
    const out = renderToStaticMarkup(listOf([NULL_ROW, KEYED_ROW], acceptViewRecording([])));

    expect(out.split(`<span>${EJES_ACCEPT_TEXT.ACCEPT}</span>`).length - 1).toBe(1);
    expect(out.split(EJES_ACCEPT_TEXT.NOT_ACCEPTABLE).length - 1).toBe(1);
  });

  it("should leave the row without reftramo out of 'Aceptar todos', so only the keyed row is sent", () => {
    const changes: EjesAcceptChange[] = [];

    toolbarOf(listOf([NULL_ROW, KEYED_ROW], acceptViewRecording(changes))).props.onAcceptAll();

    expect(changes).toEqual([{ list: EjesAcceptList.PLAIN_REMOVALS, keys: ["5001"], accepted: true }]);
  });

  it("should offer no 'Aceptar todos' at all when the only removal has no reftramo", () => {
    const toolbar = toolbarOf(listOf([NULL_ROW], acceptViewRecording([])));

    expect(toolbar.props.canAcceptAll).toBe(false);
    expect(toolbar.props.canRejectAll).toBe(false);
  });

  it("should never send the empty key, even when every other removal is accepted and 'Rechazar todos' is pressed", () => {
    const changes: EjesAcceptChange[] = [];

    toolbarOf(listOf([NULL_ROW, KEYED_ROW], acceptViewRecording(changes))).props.onRejectAll();

    for (const change of changes) {
      expect(change.keys).not.toContain("");
    }
    expect(changes).toEqual([{ list: EjesAcceptList.PLAIN_REMOVALS, keys: ["5001"], accepted: false }]);
  });
});
