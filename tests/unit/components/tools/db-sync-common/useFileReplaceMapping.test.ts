import { describe, expect, it, vi } from "vitest";
import type { DbColumnMetadata } from "@/core/types/db";
import { useFileReplaceMapping } from "@/components/tools/db-sync-common/useFileReplaceMapping";
import { SHP_GEOMETRY_SOURCE } from "@/core/types/shpReplace";

const h = vi.hoisted(() => {
  const slots: unknown[] = [];
  let idx = 0;
  return {
    reset() {
      slots.length = 0;
      idx = 0;
    },
    begin() {
      idx = 0;
    },
    useState<T>(init: T | (() => T)) {
      const i = idx++;
      if (!(i in slots)) slots[i] = typeof init === "function" ? (init as () => T)() : init;
      const set = (v: T | ((p: T) => T)) => {
        slots[i] = typeof v === "function" ? (v as (p: T) => T)(slots[i] as T) : v;
      };
      return [slots[i] as T, set] as const;
    },
  };
});

vi.mock("react", () => ({ useState: h.useState }));

function renderHook<R>(fn: () => R) {
  h.reset();
  const result = { current: undefined as unknown as R };
  const render = () => {
    h.begin();
    result.current = fn();
  };
  render();
  return {
    result,
    act(cb: () => void) {
      cb();
      render();
    },
  };
}

const detail = (
  column_name: string,
  data_type: string,
  is_nullable = true,
  column_default: string | null = null
): DbColumnMetadata => ({ column_name, data_type, is_nullable, column_default });

const TARGET_DETAILS: DbColumnMetadata[] = [
  detail("nombre", "text"),
  detail("zona", "text"),
  detail("geom", "geometry"),
];

const setup = (
  attributes: string[],
  hasGeometry: boolean,
  targetDetails: DbColumnMetadata[] = TARGET_DETAILS
) =>
  renderHook(() =>
    useFileReplaceMapping({
      attributes,
      hasGeometry,
      targetColumns: targetDetails.map((entry) => entry.column_name),
      targetDetails,
    })
  );

describe("useFileReplaceMapping", () => {
  describe("CR-13: source columns", () => {
    it("should list the CSV columns followed by the geometry pseudo column when the file has geometry", () => {
      const { result } = setup(["nombre", "zona"], true);

      expect(result.current.sourceColumns).toEqual(["nombre", "zona", SHP_GEOMETRY_SOURCE]);
      expect(result.current.sourceDetails.map((entry) => entry.data_type)).toEqual(["text", "text", "geometry"]);
    });

    it("should list only the CSV columns when the file has no geometry", () => {
      const { result } = setup(["nombre", "zona"], false);

      expect(result.current.sourceColumns).toEqual(["nombre", "zona"]);
    });

    it("should drop duplicated column names", () => {
      const { result } = setup(["nombre", "nombre"], false);

      expect(result.current.sourceColumns).toEqual(["nombre"]);
    });

    it("should return no source columns for an empty attribute list without geometry", () => {
      expect(setup([], false).result.current.sourceColumns).toEqual([]);
    });
  });

  describe("CR-13: automatic mapping", () => {
    it("should map attributes by name and send the geometry to the single geometry target column", () => {
      const { result } = setup(["nombre", "zona"], true);

      expect(result.current.mapping.sourceByTarget).toEqual({
        nombre: "nombre",
        zona: "zona",
        geom: SHP_GEOMETRY_SOURCE,
      });
    });

    it("should not map the geometry when the CSV has none", () => {
      const { result } = setup(["nombre", "zona"], false);

      expect(result.current.mapping.sourceByTarget.geom ?? null).toBeNull();
    });

    it("should never auto-match a target column to the geometry pseudo column by name", () => {
      const details = [detail("nombre", "text"), detail(SHP_GEOMETRY_SOURCE, "text")];

      const { result } = setup(["nombre"], true, details);

      expect(result.current.mapping.sourceByTarget[SHP_GEOMETRY_SOURCE] ?? null).toBeNull();
    });

    it("should not default the geometry when the target has two geometry columns", () => {
      const details = [detail("nombre", "text"), detail("geom", "geometry"), detail("geom2", "geometry")];

      const { result } = setup(["nombre"], true, details);

      expect(result.current.mapping.sourceByTarget.geom ?? null).toBeNull();
      expect(result.current.mapping.sourceByTarget.geom2 ?? null).toBeNull();
    });

    it("should leave unmatched target columns unmapped", () => {
      const { result } = setup(["otra"], false);

      expect(result.current.mapping.sourceByTarget.nombre ?? null).toBeNull();
    });
  });

  describe("CR-13: edits", () => {
    it("should apply a manual source choice over the automatic one", () => {
      const api = setup(["nombre", "zona"], true);

      api.act(() => api.result.current.setSource("nombre", "zona"));

      expect(api.result.current.mapping.sourceByTarget.nombre).toBe("zona");
    });

    it("should let the user clear the mapping of an attribute column", () => {
      const api = setup(["nombre", "zona"], true);

      api.act(() => api.result.current.setSource("zona", null));

      expect(api.result.current.mapping.sourceByTarget.zona).toBeNull();
    });

    it("should store a fixed default for a target column", () => {
      const api = setup(["nombre"], false);
      const fixed = { fieldName: "zona", value: "URBANA", useRawExpression: false };

      api.act(() => api.result.current.setDefault("zona", fixed));

      expect(api.result.current.mapping.defaults.zona).toEqual(fixed);
    });
  });

  describe("CR-13: isMappingValid", () => {
    it("should be true when at least one column is mapped and every required column is covered", () => {
      expect(setup(["nombre"], false).result.current.isMappingValid).toBe(true);
    });

    it("should be false when nothing is mapped", () => {
      expect(setup(["x"], false).result.current.isMappingValid).toBe(false);
    });

    it("should be false when a NOT NULL column without default has no source", () => {
      const details = [detail("id", "integer", false), detail("nombre", "text")];

      const { result } = setup(["nombre"], false, details);

      expect(result.current.isMappingValid).toBe(false);
    });

    it("should be true when the NOT NULL column has a database default", () => {
      const details = [detail("id", "integer", false, "nextval('t_id_seq'::regclass)"), detail("nombre", "text")];

      expect(setup(["nombre"], false, details).result.current.isMappingValid).toBe(true);
    });

    it("should become true when a fixed default covers the required column", () => {
      const details = [detail("id", "integer", false), detail("nombre", "text")];
      const api = setup(["nombre"], false, details);

      api.act(() =>
        api.result.current.setDefault("id", { fieldName: "id", value: "1", useRawExpression: false })
      );

      expect(api.result.current.isMappingValid).toBe(true);
    });

    it("should be true when only the geometry is mapped to the single geometry column", () => {
      const details = [detail("geom", "geometry", false)];

      expect(setup([], true, details).result.current.isMappingValid).toBe(true);
    });
  });
});
