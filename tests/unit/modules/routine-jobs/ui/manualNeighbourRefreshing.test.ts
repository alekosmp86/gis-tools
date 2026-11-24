import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { EjesMapNeighbour } from "@/modules/routine-jobs/jobs/ejes-calles/types";
import { ManualNeighbourList, type ManualNeighbourListProps } from "@/modules/routine-jobs/ui/ejes-calles/manualSplit/ManualNeighbourList";
import { EJES_MANUAL_SPLIT_TEXT } from "@/modules/routine-jobs/ui/ejes-calles/ejesAcceptTexts";

const neighbour = (ref: string, covered: boolean): EjesMapNeighbour => ({ ref, idcalle: "14", length: 20, points: 1, distance: 5, covered });

const listOf = (overrides: Partial<ManualNeighbourListProps> = {}): string =>
  renderToStaticMarkup(
    React.createElement(ManualNeighbourList, {
      neighbours: [neighbour("7001", false), neighbour("7002", true)],
      mergeRefs: [],
      onToggle: () => undefined,
      onTickAll: vi.fn(),
      refreshing: false,
      ...overrides,
    })
  );

/** The opening tag of the "Marcar cubiertos" button, read from the markup. */
const tickAllTagOf = (markup: string): string => {
  const labelAt = markup.indexOf(EJES_MANUAL_SPLIT_TEXT.TICK_ALL_NEIGHBOURS);
  if (labelAt === -1) throw new Error("the Marcar cubiertos button is not rendered");
  const start = markup.lastIndexOf("<button", labelAt);
  return markup.slice(start, markup.indexOf(">", start) + 1);
};

describe("ManualNeighbourList 'Marcar cubiertos' while the covered flags refresh", () => {
  it("should enable 'Marcar cubiertos' when the covered flags are current", () => {
    expect(tickAllTagOf(listOf({ refreshing: false }))).not.toContain("disabled");
  });

  it("should disable 'Marcar cubiertos' while the covered flags are refreshing", () => {
    expect(tickAllTagOf(listOf({ refreshing: true }))).toContain("disabled");
  });

  it("should show no 'Marcar cubiertos' button when no neighbour is covered, refreshing or not", () => {
    const markup = listOf({ neighbours: [neighbour("7001", false)], refreshing: true });

    expect(markup).not.toContain(EJES_MANUAL_SPLIT_TEXT.TICK_ALL_NEIGHBOURS);
  });
});
