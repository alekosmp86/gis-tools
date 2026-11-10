import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DbConfig } from "@/core/types/db";
import type { GeometryProcessingController } from "@/components/tools/db-sync-common/geometry-processing/useGeometryProcessingOptions";
import { parseSourceSrid, useShpReplaceWorkflow } from "@/components/tools/db-shapefile-sync/useShpReplaceWorkflow";

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

const TARGET = {
  host: "tgt",
  port: "5432",
  db_name: "db",
  user: "app",
  schema_name: "geo",
  table_name: "parcelas",
} as DbConfig;

const FILE = { name: "datos.csv" } as File;
const MAPPING = { sourceByTarget: { nombre: "nombre" }, defaults: {} };

const INACTIVE_OPTIONS = {
  repair: { enabled: false },
  unify: { enabled: false, keyFields: [] },
  overlaps: { enabled: false, policy: "block", minAreaM2: 1 },
};

const ACTIVE_OPTIONS = { ...INACTIVE_OPTIONS, repair: { enabled: true } };

const controller = (overrides: Partial<GeometryProcessingController> = {}): GeometryProcessingController =>
  ({
    options: ACTIVE_OPTIONS,
    isValid: true,
    prepareRun: vi.fn(),
    ...overrides,
  }) as unknown as GeometryProcessingController;

interface SetupOptions {
  target?: DbConfig | null;
  file?: File | null;
  detectedSrid?: number | null;
  geometry?: GeometryProcessingController;
  uploadId?: string | null;
}

const startRun = vi.fn(async () => undefined);

function setup(options: SetupOptions = {}) {
  const { target = TARGET, file = FILE, detectedSrid = null, geometry, uploadId = null } = options;
  return renderHook(() =>
    useShpReplaceWorkflow({ target, file, mapping: MAPPING, detectedSrid, geometry, uploadId, startRun })
  );
}

type Api = ReturnType<typeof setup>;

function fill(api: Api, srid = "32721", confirm = "geo.parcelas", password = "pw") {
  api.act(() => api.result.current.setSridText(srid));
  api.act(() => api.result.current.setConfirmValue(confirm));
  api.act(() => api.result.current.setPassword(password));
}

describe("useShpReplaceWorkflow", () => {
  beforeEach(() => {
    startRun.mockClear();
  });

  describe("CR-13: parseSourceSrid", () => {
    it.each([
      ["32721", 32721],
      [" 4326 ", 4326],
      ["1", 1],
      ["998999", 998999],
    ])("should parse %j as %i", (text, expected) => {
      expect(parseSourceSrid(text)).toBe(expected);
    });

    it.each(["", "  ", "0", "999000", "-5", "43.26", "abc", "1e3", "4326x"])("should return null for %j", (text) => {
      expect(parseSourceSrid(text)).toBeNull();
    });
  });

  describe("CR-13: without a geometry processing controller", () => {
    it("should expose schema.table as confirmText and an empty one without a target", () => {
      expect(setup().result.current.confirmText).toBe("geo.parcelas");
      expect(setup({ target: null }).result.current.confirmText).toBe("");
    });

    it("should seed the SRID text from the detected SRID and leave it empty when none was detected", () => {
      expect(setup({ detectedSrid: 32721 }).result.current.sridText).toBe("32721");
      expect(setup({ detectedSrid: null }).result.current.sridText).toBe("");
    });

    it("should not let the run proceed initially", () => {
      const { result } = setup();

      expect(result.current.canRun).toBe(false);
      expect(result.current.canAnalyze).toBe(false);
    });

    it("should enable canRun when SRID, confirmation and password are valid even though there is no processing controller", () => {
      const api = setup();

      fill(api);

      expect(api.result.current.canRun).toBe(true);
    });

    it("should keep canAnalyze false because without a controller no geometry processing is active", () => {
      const api = setup();

      fill(api);

      expect(api.result.current.canAnalyze).toBe(false);
    });

    it("should keep canRun false when the confirmation text does not match exactly", () => {
      const api = setup();

      fill(api, "32721", "GEO.parcelas");

      expect(api.result.current.canRun).toBe(false);
    });

    it("should keep canRun false when the SRID is invalid", () => {
      const api = setup();

      fill(api, "0");

      expect(api.result.current.sourceSrid).toBeNull();
      expect(api.result.current.canRun).toBe(false);
    });

    it("should keep canRun false when the password is blank", () => {
      const api = setup();

      fill(api, "32721", "geo.parcelas", "   ");

      expect(api.result.current.canRun).toBe(false);
    });

    it("should keep canRun false when there is no file or no target", () => {
      const noFile = setup({ file: null });
      const noTarget = setup({ target: null });
      fill(noFile);
      fill(noTarget, "32721", "");

      expect(noFile.result.current.canRun).toBe(false);
      expect(noTarget.result.current.canRun).toBe(false);
    });

    it("should call startRun with a real run, no processing and the password, then clear the password", () => {
      const api = setup({ uploadId: "up-1" });
      fill(api, "32721", "geo.parcelas", "s3cret");

      api.act(() => api.result.current.run());

      expect(startRun).toHaveBeenCalledTimes(1);
      expect(startRun).toHaveBeenCalledWith({
        file: FILE,
        fileName: "datos.csv",
        connection: { ...TARGET, password: "s3cret" },
        mapping: MAPPING,
        sourceSrid: 32721,
        resetSequences: true,
        processing: undefined,
        dryRun: false,
        uploadId: "up-1",
      });
      expect(api.result.current.password).toBe("");
    });

    it("should pass an undefined uploadId when no upload exists yet", () => {
      const api = setup({ uploadId: null });
      fill(api);

      api.act(() => api.result.current.run());

      expect(startRun.mock.calls[0]).toEqual([expect.objectContaining({ uploadId: undefined })]);
    });

    it("should honour the reset sequences toggle", () => {
      const api = setup();
      fill(api);
      api.act(() => api.result.current.setResetSequences(false));

      api.act(() => api.result.current.run());

      expect(startRun).toHaveBeenCalledWith(expect.objectContaining({ resetSequences: false }));
    });

    it("should not start the run when the gates are closed", () => {
      const api = setup();

      api.act(() => api.result.current.run());
      api.act(() => api.result.current.analyze());

      expect(startRun).not.toHaveBeenCalled();
    });

    it("should not analyze without a controller even when the form is complete", () => {
      const api = setup();
      fill(api);

      api.act(() => api.result.current.analyze());

      expect(startRun).not.toHaveBeenCalled();
    });

    it("should toggle the password visibility", () => {
      const api = setup();

      api.act(() => api.result.current.toggleShowPassword());
      expect(api.result.current.showPassword).toBe(true);
      api.act(() => api.result.current.toggleShowPassword());
      expect(api.result.current.showPassword).toBe(false);
    });
  });

  describe("CR-13: with a geometry processing controller (shapefile behavior)", () => {
    it("should enable canAnalyze when the controller is valid and processing is active", () => {
      const api = setup({ geometry: controller() });

      fill(api);

      expect(api.result.current.canAnalyze).toBe(true);
    });

    it("should disable canAnalyze and canRun when the controller options are invalid", () => {
      const api = setup({ geometry: controller({ isValid: false } as Partial<GeometryProcessingController>) });

      fill(api);

      expect(api.result.current.canAnalyze).toBe(false);
      expect(api.result.current.canRun).toBe(false);
    });

    it("should prepare the run on the controller and pass its options when running or analyzing", () => {
      const geometry = controller();
      const api = setup({ geometry });
      fill(api);

      api.act(() => api.result.current.analyze());

      expect(geometry.prepareRun).toHaveBeenCalledWith(ACTIVE_OPTIONS, true);
      expect(startRun).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true, processing: ACTIVE_OPTIONS }));
    });
  });
});
