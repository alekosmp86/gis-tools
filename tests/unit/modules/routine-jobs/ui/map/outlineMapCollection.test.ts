import { describe, expect, it } from "vitest";
import { MAP_ROLE_TYPE } from "@/core/constants/mapConstants";
import { OUTLINE_LABEL_LIMIT, OUTLINE_LABEL_PROPERTY, toMapCollection } from "@/modules/routine-jobs/ui/map/outlineMapCollection";
import { OUTLINE_ROLE, type OutlineFeature, type OutlineLabel } from "@/modules/routine-jobs/ui/map/outlineTypes";

const POINT = { type: "Point" as const, coordinates: [-56.1, -34.9] };

const featureOf = (itemIndex: number, role: OutlineFeature["role"]): OutlineFeature => ({
  itemIndex,
  role,
  label: "",
  geometry: POINT,
});

const outlineOf = (label: string, mapType?: string): OutlineLabel => ({
  label,
  ...(mapType === undefined ? {} : { mapType }),
});

describe("toMapCollection", () => {
  it("should colour a candidate outline with its own map type, not with its role colour", () => {
    const outlines = [outlineOf("RURAL 501 · nuevo"), outlineOf("URBANO 200 · candidato 1 (id 500)", "PADRON_CANDIDATO_1")];

    const collection = toMapCollection([featureOf(1, OUTLINE_ROLE.OLD)], outlines);

    expect(collection.features[0].properties).toMatchObject({
      _discrepancyType: "PADRON_CANDIDATO_1",
      [OUTLINE_LABEL_PROPERTY]: "URBANO 200 · candidato 1 (id 500)",
    });
  });

  it("should colour an outline without a map type by its role: the old outline as previous and the new one as new", () => {
    const outlines = [outlineOf("URBANO 200 · anterior"), outlineOf("RURAL 501 · nuevo")];

    const collection = toMapCollection([featureOf(0, OUTLINE_ROLE.OLD), featureOf(1, OUTLINE_ROLE.NEW)], outlines);

    expect(collection.features.map((feature) => feature.properties?._discrepancyType)).toEqual([
      MAP_ROLE_TYPE.OLD,
      MAP_ROLE_TYPE.NEW,
    ]);
  });

  it("should label each feature with the minimal label of the outline its item index names", () => {
    const outlines = [outlineOf("RURAL 501 · nuevo"), outlineOf("URBANO 200 · anterior")];

    const collection = toMapCollection([featureOf(1, OUTLINE_ROLE.OLD)], outlines);

    expect(collection.features[0].properties?.[OUTLINE_LABEL_PROPERTY]).toBe("URBANO 200 · anterior");
  });

  it("should fall back to an empty label and the role colour when the item index names no outline", () => {
    const collection = toMapCollection([featureOf(3, OUTLINE_ROLE.NEW)], [outlineOf("RURAL 501 · nuevo")]);

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

describe("toMapCollection zone outlines (ET-8)", () => {
  it("should colour a zone outline by its own map type, not by the role colour", () => {
    const outlines = [outlineOf("Padrones urbanos cercanos", "PADRON_ZONA_URBANA"), outlineOf("Padrones rurales cercanos", "PADRON_ZONA_RURAL")];

    const collection = toMapCollection([featureOf(0, OUTLINE_ROLE.ZONE), featureOf(1, OUTLINE_ROLE.ZONE)], outlines);

    expect(collection.features.map((feature) => feature.properties?._discrepancyType)).toEqual([
      "PADRON_ZONA_URBANA",
      "PADRON_ZONA_RURAL",
    ]);
    expect(collection.features.map((feature) => feature.properties?.[OUTLINE_LABEL_PROPERTY])).toEqual([
      "Padrones urbanos cercanos",
      "Padrones rurales cercanos",
    ]);
  });

  it("should colour the new section of a twin by its section map type", () => {
    const collection = toMapCollection([featureOf(0, OUTLINE_ROLE.NEW)], [outlineOf("1035386 · nuevo", "TRAMO_NUEVO")]);

    expect(collection.features[0].properties?._discrepancyType).toBe("TRAMO_NUEVO");
  });
});

describe("toMapCollection label limit", () => {
  const manyOf = (count: number) => Array.from({ length: count }, (_, index) => index);

  it("should keep every label up to the limit", () => {
    const ids = manyOf(OUTLINE_LABEL_LIMIT);
    const collection = toMapCollection(ids.map((id) => featureOf(id, OUTLINE_ROLE.OLD)), ids.map((id) => outlineOf(`ref ${id}`)));

    expect(collection.features.every((feature) => feature.properties?.[OUTLINE_LABEL_PROPERTY] !== "")).toBe(true);
  });

  it("should draw no permanent label past the limit, so the map stays readable", () => {
    const ids = manyOf(OUTLINE_LABEL_LIMIT + 1);
    const collection = toMapCollection(ids.map((id) => featureOf(id, OUTLINE_ROLE.OLD)), ids.map((id) => outlineOf(`ref ${id}`)));

    expect(collection.features.every((feature) => feature.properties?.[OUTLINE_LABEL_PROPERTY] === "")).toBe(true);
  });
});

describe("toMapCollection label slots", () => {
  it("should give every feature its own label slot, in feature order", () => {
    const outlines = [outlineOf("a"), outlineOf("b")];

    const collection = toMapCollection([featureOf(0, OUTLINE_ROLE.OLD), featureOf(1, OUTLINE_ROLE.NEW)], outlines);

    expect(collection.features.map((feature) => feature.properties?._labelSlot)).toEqual([0, 1]);
  });
});
