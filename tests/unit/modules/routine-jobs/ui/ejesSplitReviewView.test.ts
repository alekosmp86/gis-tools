import type { Feature, Geometry } from "geojson";
import { describe, expect, it } from "vitest";
import { EJES_POINT_REASON } from "@/modules/routine-jobs/jobs/ejes-calles/constants";
import type { EjesSplitReviewPoint, EjesStreet } from "@/modules/routine-jobs/jobs/ejes-calles/types";
import { getDiscrepancyColor } from "@/core/constants/mapConstants";
import { splitPointMapOf, splitStreetViewOf, type SplitPointMapSource } from "@/modules/routine-jobs/ui/ejes-calles/splitReview/ejesSplitReviewView";

const LINE: Geometry = { type: "LineString", coordinates: [[-56.1, -34.9], [-56.2, -34.95]] };
const POINT_GEOMETRY: Geometry = { type: "Point", coordinates: [-56.15, -34.92] };

const pointOf = (overrides: Partial<EjesSplitReviewPoint> = {}): EjesSplitReviewPoint => ({
  pointId: "11",
  reason: EJES_POINT_REASON.AMBIGUOUS,
  number: null,
  letter: null,
  km: null,
  circulationWay: null,
  geometry: POINT_GEOMETRY,
  pointStreet: null,
  candidates: [],
  ...overrides,
});

const piecesOf = (count: number): SplitPointMapSource["pieces"] =>
  Array.from({ length: count }, (_, index) => ({ newRef: `600${index + 2}`, geometry: LINE }));

const featuresOf = (collection: ReturnType<typeof splitPointMapOf>): Feature[] => collection.features as Feature[];

const byType = (features: Feature[], type: string): Feature | undefined =>
  features.find((feature) => feature.properties?._discrepancyType === type);

describe("splitPointMapOf: one colour per piece (EJS-6, EJS-19)", () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8])("should draw %i piece(s) each in a distinct colour and type", (count) => {
    const collection = splitPointMapOf({ pieces: piecesOf(count), oldGeometry: LINE }, "6001", pointOf(), undefined);

    const pieceTypes = featuresOf(collection)
      .map((feature) => feature.properties?._discrepancyType as string)
      .filter((type) => type.startsWith("TRAMO_CANDIDATO_"));
    const colours = pieceTypes.map((type) => getDiscrepancyColor(type));

    expect(pieceTypes).toHaveLength(count);
    expect(new Set(pieceTypes).size).toBe(count);
    expect(new Set(colours).size).toBe(count);
  });
});

describe("splitPointMapOf: labels and features (EJS-6, EJS-19)", () => {
  const point = pointOf({
    candidates: [
      { newRef: "6002", distance: 4.2, isSuggestion: true },
      { newRef: "6003", distance: null, isSuggestion: false },
    ],
  });

  it("should name a piece with its distance and its suggested and chosen marks", () => {
    const collection = splitPointMapOf({ pieces: piecesOf(2), oldGeometry: null }, "6001", point, "6002");

    expect(byType(featuresOf(collection), "TRAMO_CANDIDATO_1")?.properties?.label).toBe("Tramo nuevo 6002 · 4,2 m · Sugerido · Elegido");
  });

  it("should omit the distance of a piece whose distance is null, and keep the piece name", () => {
    const collection = splitPointMapOf({ pieces: piecesOf(2), oldGeometry: null }, "6001", point, undefined);

    expect(byType(featuresOf(collection), "TRAMO_CANDIDATO_2")?.properties?.label).toBe("Tramo nuevo 6003");
  });

  it("should name a piece with no candidate of the point by its reftramo alone (missing candidate)", () => {
    const collection = splitPointMapOf({ pieces: [{ newRef: "6099", geometry: LINE }], oldGeometry: null }, "6001", point, undefined);

    expect(byType(featuresOf(collection), "TRAMO_CANDIDATO_1")?.properties?.label).toBe("Tramo nuevo 6099");
  });

  it("should draw the access point as PUNTO_ACCESO labelled with its id", () => {
    const collection = splitPointMapOf({ pieces: piecesOf(1), oldGeometry: null }, "6001", point, undefined);

    expect(byType(featuresOf(collection), "PUNTO_ACCESO")?.properties?.label).toBe("Punto de acceso 11");
  });

  it("should omit the access point feature when the point has no geometry (null geometry)", () => {
    const collection = splitPointMapOf({ pieces: piecesOf(1), oldGeometry: null }, "6001", pointOf({ geometry: null }), undefined);

    expect(byType(featuresOf(collection), "PUNTO_ACCESO")).toBeUndefined();
  });

  it("should draw the old section as TRAMO_ANTERIOR only when it has a geometry", () => {
    const withOld = splitPointMapOf({ pieces: [], oldGeometry: LINE }, "6001", point, undefined);
    const withoutOld = splitPointMapOf({ pieces: [], oldGeometry: null }, "6001", point, undefined);

    expect(byType(featuresOf(withOld), "TRAMO_ANTERIOR")?.properties?.label).toBe("Tramo anterior 6001");
    expect(byType(featuresOf(withoutOld), "TRAMO_ANTERIOR")).toBeUndefined();
  });
});

describe("splitStreetViewOf: the street lines of a point and its old section (EJS-19)", () => {
  const RUTA_25: EjesStreet = { idcalle: "71939", name: "RUTA 25" };
  const RUTA_30: EjesStreet = { idcalle: "80001", name: "RUTA 30" };

  it("should show one line for the same street on both sides, with no mismatch", () => {
    const view = splitStreetViewOf(RUTA_25, { ...RUTA_25 });

    expect(view.lines).toEqual(["Calle: RUTA 25 (71939)"]);
    expect(view.mismatch).toBe(false);
  });

  it("should show two lines and a mismatch for different idcalle values", () => {
    const view = splitStreetViewOf(RUTA_25, RUTA_30);

    expect(view.lines).toEqual(["Calle del punto: RUTA 25 (idcalle 71939)", "Calle del tramo anterior: RUTA 30 (idcalle 80001)"]);
    expect(view.mismatch).toBe(true);
  });

  it("should show the idcalle alone when the street has no name (null name)", () => {
    const view = splitStreetViewOf({ idcalle: "5", name: null }, { idcalle: "6", name: null });

    expect(view.lines).toEqual(["Calle del punto: idcalle 5", "Calle del tramo anterior: idcalle 6"]);
    expect(view.mismatch).toBe(true);
  });

  it("should show the idcalle alone for the same street with no name (null name, same idcalle)", () => {
    const view = splitStreetViewOf({ idcalle: "5", name: null }, { idcalle: "5", name: null });

    expect(view.lines).toEqual(["Calle: idcalle 5"]);
    expect(view.mismatch).toBe(false);
  });

  it("should show no data for a missing street on both sides, without a mismatch (null street)", () => {
    const view = splitStreetViewOf(null, null);

    expect(view.lines).toEqual(["Calle: sin dato"]);
    expect(view.mismatch).toBe(false);
  });

  it("should show no data for the point and the street of the old section, without a mismatch when the point has none (null street)", () => {
    const view = splitStreetViewOf(null, RUTA_25);

    expect(view.lines).toEqual(["Calle del punto: sin dato", "Calle del tramo anterior: RUTA 25 (idcalle 71939)"]);
    expect(view.mismatch).toBe(false);
  });
});
