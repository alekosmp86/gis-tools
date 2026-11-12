import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EjesGeometryMapBase } from "@/modules/routine-jobs/ui/clientTypes";
import { EjesMapView } from "@/modules/routine-jobs/ui/EjesMapView";
import { subjectOfSplit, subjectOfTwin } from "@/modules/routine-jobs/ui/ejesMapSubject";
import { OUTLINE_LABEL_PROPERTY } from "@/modules/routine-jobs/ui/map/outlineMapCollection";
import { OutlineMapView } from "@/modules/routine-jobs/ui/map/OutlineMapView";
import type { OutlineFeature } from "@/modules/routine-jobs/ui/map/outlineTypes";
import { MapLoadStatus, type OutlineMapFeatures } from "@/modules/routine-jobs/ui/map/useOutlineMapFeatures";

const shown = vi.hoisted(() => ({ props: [] as Array<Record<string, unknown>>, map: null as unknown }));

vi.mock("next/dynamic", () => ({
  default: () => (props: Record<string, unknown>) => {
    shown.props.push(props);
    return null;
  },
}));

vi.mock("@/modules/routine-jobs/ui/useEjesMapFeatures", () => ({
  useEjesMapFeatures: () => shown.map,
}));

const LINE = { type: "LineString" as const, coordinates: [[-56.1, -34.9], [-56.0, -34.9]] };

const featureOf = (itemIndex: number): OutlineFeature => ({ itemIndex, role: "new", label: `item ${itemIndex}`, geometry: LINE });

const readyMap = (count: number): OutlineMapFeatures => ({
  status: MapLoadStatus.READY,
  features: Array.from({ length: count }, (_, index) => featureOf(index)),
  message: null,
  retry: () => undefined,
});

const NOOP = (): void => undefined;

const BASE: EjesGeometryMapBase = {
  connection: { host: "h", port: "5432", db_name: "d", user: "u", password: "p" },
  tables: {
    "ejes-origen": { schema: "a", table: "b" },
    "ejes-tramos": { schema: "a", table: "c" },
    "ejes-padrones": { schema: "a", table: "d" },
  },
};

const lastProps = (): Record<string, unknown> => shown.props[shown.props.length - 1];

describe("OutlineMapView showLabels (ET-17)", () => {
  beforeEach(() => {
    shown.props.length = 0;
  });

  const outlines = [{ label: "a" }, { label: "b" }];
  const render = (showLabels?: boolean): void => {
    renderToStaticMarkup(
      React.createElement(OutlineMapView, {
        map: readyMap(2),
        outlines,
        title: "T",
        emptyMessage: "vacío",
        selectedOutlineIndex: null,
        onSelectOutline: NOOP,
        ...(showLabels === undefined ? {} : { showLabels }),
      })
    );
  };

  it("should draw the labels by default: the label property and coded labels", () => {
    render();

    expect(lastProps().labelProperty).toBe(OUTLINE_LABEL_PROPERTY);
    expect(lastProps().codedLabels).toBe(true);
    const labels = (lastProps().geojson as { features: Array<{ properties: Record<string, unknown> }> }).features.map(
      (feature) => feature.properties[OUTLINE_LABEL_PROPERTY]
    );
    expect(labels).toEqual(["a", "b"]);
  });

  it("should pass no label property and no coded labels when showLabels is false, and empty labels in the collection", () => {
    render(false);

    expect(lastProps().labelProperty).toBeUndefined();
    expect(lastProps().codedLabels).toBe(false);
    const labels = (lastProps().geojson as { features: Array<{ properties: Record<string, unknown> }> }).features.map(
      (feature) => feature.properties[OUTLINE_LABEL_PROPERTY]
    );
    expect(labels).toEqual(["", ""]);
  });

  it("should draw the labels when showLabels is true", () => {
    render(true);

    expect(lastProps().labelProperty).toBe(OUTLINE_LABEL_PROPERTY);
    expect(lastProps().codedLabels).toBe(true);
  });
});

describe("EjesMapView showLabels (ET-17)", () => {
  beforeEach(() => {
    shown.props.length = 0;
  });

  const renderSubject = (subject: ReturnType<typeof subjectOfTwin>): void => {
    shown.map = readyMap(subject.outlines.length);
    renderToStaticMarkup(
      React.createElement(EjesMapView, { subject, base: BASE, selectedOutlineIndex: null, onSelectOutline: NOOP })
    );
  };

  it("should draw no permanent label on a twin row, where identical copies would pile their labels", () => {
    renderSubject(
      subjectOfTwin({
        ref: "1",
        idcalle: "2",
        department: "FLORES",
        localities: ["A", "B"],
        class: "NEITHER",
        length: 10,
        urbanLength: 0,
        ruralLength: 0,
        dropLocalities: [],
      })
    );

    expect(lastProps().labelProperty).toBeUndefined();
    expect(lastProps().codedLabels).toBe(false);
  });

  it("should keep the permanent labels on a split", () => {
    renderSubject(
      subjectOfSplit({
        oldRef: "1",
        idcalle: "2",
        newRefs: ["3", "4"],
        points: 0,
        coverage: 1,
        oldLength: 1,
        newLength: 1,
        outsideLength: 0,
      })
    );

    expect(lastProps().labelProperty).toBe(OUTLINE_LABEL_PROPERTY);
    expect(lastProps().codedLabels).toBe(true);
  });
});
