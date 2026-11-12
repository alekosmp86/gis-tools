import { describe, expect, it } from "vitest";
import { MAP_ROLE_TYPE } from "@/core/constants/mapConstants";
import { GEOMETRY_MAP_ROLE } from "@/modules/routine-jobs/jobs/actualizar-padron/constants";
import type { GeometryMapFeature } from "@/modules/routine-jobs/jobs/actualizar-padron/types";
import { OUTLINE_LABEL_PROPERTY, toMapCollection } from "@/modules/routine-jobs/ui/padronMapCollection";
import type { PadronMapOutline } from "@/modules/routine-jobs/ui/padronMapSubject";

const POINT = { type: "Point" as const, coordinates: [-56.1, -34.9] };

const featureOf = (itemIndex: number, role: GeometryMapFeature["role"]): GeometryMapFeature => ({
  itemIndex,
  role,
  label: "",
  geometry: POINT,
});

const outlineOf = (label: string, mapType?: string): PadronMapOutline => ({
  label,
  details: {
    typePadron: null,
    department: null,
    locality: null,
    number: null,
    currentId: null,
    oldAreaM2: null,
    newAreaM2: null,
    areaChangePct: null,
    areaChangeKind: "signed",
    centroidLat: null,
    centroidLon: null,
    previous: null,
  },
  catastro: [],
  ...(mapType === undefined ? {} : { mapType }),
});

describe("toMapCollection", () => {
  it("should colour a candidate outline with its own map type, not with its role colour", () => {
    const outlines = [outlineOf("RURAL 501 · nuevo"), outlineOf("URBANO 200 · candidato 1 (id 500)", "PADRON_CANDIDATO_1")];

    const collection = toMapCollection([featureOf(1, GEOMETRY_MAP_ROLE.OLD)], outlines);

    expect(collection.features[0].properties).toMatchObject({
      _discrepancyType: "PADRON_CANDIDATO_1",
      [OUTLINE_LABEL_PROPERTY]: "URBANO 200 · candidato 1 (id 500)",
    });
  });

  it("should colour an outline without a map type by its role: the old outline as previous and the new one as new", () => {
    const outlines = [outlineOf("URBANO 200 · anterior"), outlineOf("RURAL 501 · nuevo")];

    const collection = toMapCollection([featureOf(0, GEOMETRY_MAP_ROLE.OLD), featureOf(1, GEOMETRY_MAP_ROLE.NEW)], outlines);

    expect(collection.features.map((feature) => feature.properties?._discrepancyType)).toEqual([
      MAP_ROLE_TYPE.OLD,
      MAP_ROLE_TYPE.NEW,
    ]);
  });

  it("should label each feature with the minimal label of the outline its item index names", () => {
    const outlines = [outlineOf("RURAL 501 · nuevo"), outlineOf("URBANO 200 · anterior")];

    const collection = toMapCollection([featureOf(1, GEOMETRY_MAP_ROLE.OLD)], outlines);

    expect(collection.features[0].properties?.[OUTLINE_LABEL_PROPERTY]).toBe("URBANO 200 · anterior");
  });

  it("should fall back to an empty label and the role colour when the item index names no outline", () => {
    const collection = toMapCollection([featureOf(3, GEOMETRY_MAP_ROLE.NEW)], [outlineOf("RURAL 501 · nuevo")]);

    expect(collection.features[0].properties).toEqual({
      _discrepancyType: MAP_ROLE_TYPE.NEW,
      [OUTLINE_LABEL_PROPERTY]: "",
      _labelSlot: 0,
    });
  });

  it("should return an empty feature collection for no features", () => {
    expect(toMapCollection([], [])).toEqual({ type: "FeatureCollection", features: [] });
  });
});

describe("toMapCollection label slots", () => {
  it("should give every feature its own label slot, in feature order", () => {
    const outlines = [outlineOf("a"), outlineOf("b")];

    const collection = toMapCollection([featureOf(0, GEOMETRY_MAP_ROLE.OLD), featureOf(1, GEOMETRY_MAP_ROLE.NEW)], outlines);

    expect(collection.features.map((feature) => feature.properties?._labelSlot)).toEqual([0, 1]);
  });
});
