import { describe, it, expect, vi } from "vitest";

vi.mock("leaflet", () => ({
  default: {
    circleMarker: (latlng: unknown, options: unknown) => ({ latlng, options }),
  },
}));

import type { Feature } from "geojson";
import { createStyleResolver } from "@/ui-kit/map/MapSymbologyStyler";
import { DEFAULT_MAP_FEATURE_STYLE, getDiscrepancyColor } from "@/core/constants/mapConstants";
import { MapStrokePattern, type MapFeatureStyle } from "@/core/types/map";

const style = (over: Partial<MapFeatureStyle> = {}): MapFeatureStyle => ({
  ...DEFAULT_MAP_FEATURE_STYLE,
  color: "#111111",
  fillColor: "#222222",
  weight: 2,
  opacity: 0.8,
  fillOpacity: 0.4,
  pointRadius: 9,
  ...over,
});

const feat = (type?: unknown): Feature => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [0, 0] },
  properties: type === undefined ? {} : { _discrepancyType: type },
});

const canvas = { canvas: true } as never;
const latlng = { lat: 1, lng: 2 } as never;

const path = (f: Feature | undefined, s: MapFeatureStyle, c: unknown = null) =>
  createStyleResolver(s, c as never).resolvePathStyle(f);
const point = (f: Feature | undefined, s: MapFeatureStyle, c: unknown = null) =>
  (createStyleResolver(s, c as never).createPointLayer(f, latlng) as unknown as {
    latlng: unknown;
    options: Record<string, unknown>;
  });

describe("MapSymbologyStyler", () => {
  describe("computePathStyle (via resolvePathStyle)", () => {
    it("should use discrepancy colour for stroke and fill when a type is present and not overridden", () => {
      const r = path(feat("ATTRIBUTE_MISMATCH"), style());

      expect(r.color).toBe(getDiscrepancyColor("ATTRIBUTE_MISMATCH"));
      expect(r.fillColor).toBe(getDiscrepancyColor("ATTRIBUTE_MISMATCH"));
    });

    it("should use the unknown-type default discrepancy colour for unrecognised string types", () => {
      const r = path(feat("SOMETHING_ELSE"), style());

      expect(r.color).toBe(getDiscrepancyColor("SOMETHING_ELSE"));
      expect(r.fillColor).toBe(getDiscrepancyColor("SOMETHING_ELSE"));
    });

    it("should use style colours when overrideDiscrepancyColors is true", () => {
      const r = path(feat("ATTRIBUTE_MISMATCH"), style({ overrideDiscrepancyColors: true }));

      expect(r.color).toBe("#111111");
      expect(r.fillColor).toBe("#222222");
    });

    it("should use style colours when there is no discrepancy type or no feature", () => {
      expect(path(feat(), style())).toMatchObject({ color: "#111111", fillColor: "#222222" });
      expect(path(undefined, style())).toMatchObject({ color: "#111111", fillColor: "#222222" });
      expect(path({ type: "Feature", geometry: null as never, properties: null }, style())).toMatchObject({
        color: "#111111",
      });
    });

    it("should fall back fill to style.color when fillColor is empty", () => {
      const r = path(feat(), style({ fillColor: "" }));

      expect(r.fillColor).toBe("#111111");
    });

    it("should use dashed 6,6 and fillOpacity 0.25 for FILE_FEATURE", () => {
      const r = path(feat("FILE_FEATURE"), style());

      expect(r.dashArray).toBe("6, 6");
      expect(r.fillOpacity).toBe(0.25);
    });

    it("should use no dash and fillOpacity 0.2 for DB_FEATURE even with a dashed pattern", () => {
      const r = path(feat("DB_FEATURE"), style({ strokePattern: MapStrokePattern.DASHED }));

      expect(r.dashArray).toBeUndefined();
      expect(r.fillOpacity).toBe(0.2);
    });

    it("should take dashArray from the stroke pattern and fillOpacity from style for other types", () => {
      expect(path(feat(), style({ strokePattern: MapStrokePattern.DOTTED }))).toMatchObject({
        dashArray: "2, 5",
        fillOpacity: 0.4,
      });
      expect(path(feat("ATTRIBUTE_MISMATCH"), style({ strokePattern: MapStrokePattern.DASHED }))).toMatchObject({
        dashArray: "6, 6",
        fillOpacity: 0.4,
      });
      expect(path(feat(), style({ strokePattern: MapStrokePattern.SOLID })).dashArray).toBeUndefined();
    });

    it("should apply special FILE_FEATURE/DB_FEATURE dash and opacity even when colours are overridden", () => {
      const r = path(feat("FILE_FEATURE"), style({ overrideDiscrepancyColors: true }));

      expect(r).toMatchObject({ color: "#111111", dashArray: "6, 6", fillOpacity: 0.25 });
    });

    it("should enforce a minimum weight of 3 and keep larger weights", () => {
      expect(path(feat(), style({ weight: 1 })).weight).toBe(3);
      expect(path(feat(), style({ weight: 3.5 })).weight).toBe(3.5);
    });

    it("should pass opacity through and set renderer to canvas or undefined", () => {
      const withCanvas = path(feat(), style(), canvas);
      const without = path(feat(), style(), null);

      expect(withCanvas.renderer).toBe(canvas);
      expect(without.renderer).toBeUndefined();
      expect(without.opacity).toBe(0.8);
    });

    it("should ignore a non-string discrepancy type's cache key but still colour by truthiness", () => {
      const r = path(feat(42), style());

      expect(r.color).toBe(getDiscrepancyColor(42 as never));
    });
  });

  describe("createPointMarker (via createPointLayer)", () => {
    it("should build a circle marker at latlng with radius and discrepancy fill, white stroke", () => {
      const m = point(feat("ATTRIBUTE_MISMATCH"), style());

      expect(m.latlng).toBe(latlng);
      expect(m.options).toEqual({
        renderer: undefined,
        radius: 9,
        fillColor: getDiscrepancyColor("ATTRIBUTE_MISMATCH"),
        color: "#ffffff",
        weight: 2,
        opacity: 0.8,
        fillOpacity: 0.7,
      });
    });

    it("should use style colours when overridden", () => {
      const m = point(feat("ATTRIBUTE_MISMATCH"), style({ overrideDiscrepancyColors: true }));

      expect(m.options.color).toBe("#111111");
      expect(m.options.fillColor).toBe("#222222");
    });

    it("should use style colours with fillColor fallback to color when no discrepancy", () => {
      expect(point(feat(), style()).options).toMatchObject({ color: "#111111", fillColor: "#222222" });
      expect(point(undefined, style({ fillColor: "" })).options).toMatchObject({
        color: "#111111",
        fillColor: "#111111",
      });
    });

    it("should cap weight at 3 and floor fillOpacity at 0.7", () => {
      const high = point(feat(), style({ weight: 8, fillOpacity: 0.9 }));
      const low = point(feat(), style({ weight: 1, fillOpacity: 0.1 }));

      expect(high.options).toMatchObject({ weight: 3, fillOpacity: 0.9 });
      expect(low.options).toMatchObject({ weight: 1, fillOpacity: 0.7 });
    });

    it("should pass the canvas renderer through, or undefined when null", () => {
      expect(point(feat(), style(), canvas).options.renderer).toBe(canvas);
      expect(point(feat(), style(), null).options.renderer).toBeUndefined();
    });

    it("should not apply FILE_FEATURE/DB_FEATURE dash/opacity rules to point markers", () => {
      const m = point(feat("FILE_FEATURE"), style());

      expect(m.options.fillColor).toBe(getDiscrepancyColor("FILE_FEATURE"));
      expect(m.options).not.toHaveProperty("dashArray");
      expect(m.options.fillOpacity).toBe(0.7);
    });
  });

  describe("createStyleResolver caching", () => {
    it("should return the same options object for features with the same discrepancy type", () => {
      const resolver = createStyleResolver(style(), null);

      const a = resolver.resolvePathStyle(feat("ATTRIBUTE_MISMATCH"));
      const b = resolver.resolvePathStyle(feat("ATTRIBUTE_MISMATCH"));

      expect(a).toBe(b);
    });

    it("should return different options objects for different discrepancy types", () => {
      const resolver = createStyleResolver(style(), null);

      const a = resolver.resolvePathStyle(feat("ATTRIBUTE_MISMATCH"));
      const b = resolver.resolvePathStyle(feat("FILE_FEATURE"));

      expect(a).not.toBe(b);
      expect(a.color).not.toBe(b.color);
    });

    it("should share one default entry for features without a type, undefined features and non-string types", () => {
      const resolver = createStyleResolver(style(), null);

      const a = resolver.resolvePathStyle(feat());
      const b = resolver.resolvePathStyle(undefined);

      expect(a).toBe(b);
      expect(a.color).toBe("#111111");
    });

    it("should key a non-string truthy type into the default entry (cached first-come style)", () => {
      const resolver = createStyleResolver(style(), null);

      const first = resolver.resolvePathStyle(feat());
      const second = resolver.resolvePathStyle(feat(42));

      expect(second).toBe(first);
    });

    it("should not share caches between resolvers", () => {
      const a = createStyleResolver(style(), null).resolvePathStyle(feat("FILE_FEATURE"));
      const b = createStyleResolver(style(), null).resolvePathStyle(feat("FILE_FEATURE"));

      expect(a).not.toBe(b);
      expect(a).toEqual(b);
    });

    it("should not cache point layers: each call creates a new marker", () => {
      const resolver = createStyleResolver(style(), null);

      const a = resolver.createPointLayer(feat("FILE_FEATURE"), latlng);
      const b = resolver.createPointLayer(feat("FILE_FEATURE"), latlng);

      expect(a).not.toBe(b);
    });

    it("should work when detached from the class (convenience export is a static reference)", () => {
      expect(() => createStyleResolver(style(), null)).not.toThrow();
    });
  });
});
