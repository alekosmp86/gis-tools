import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DbColumnMetadata, DbConfig } from "@/core/types/db";
import { useFullReplaceWorkflow } from "@/components/tools/db-sync-common/useFullReplaceWorkflow";

const h = vi.hoisted(() => {
  const slots: unknown[] = [];
  let idx = 0;
  return {
    storeStatus: { value: "idle" as string },
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

const startMock = vi.hoisted(() => vi.fn());

vi.mock("react", () => ({ useState: h.useState }));
vi.mock("@/core/services/fullReplaceRunStore", () => ({
  FullReplaceRunStatus: { IDLE: "idle", RUNNING: "running", DONE: "done", FAILED: "failed" },
  start: startMock,
}));
vi.mock("@/components/tools/db-sync-common/useFullReplaceRun", () => ({
  useFullReplaceRun: () => ({ status: h.storeStatus.value }),
}));

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
    rerender: render,
  };
}

const source = { table_name: "src", schema_name: "s" } as unknown as DbConfig;
const target = (schema_name: string) => ({ table_name: "parcels", schema_name }) as unknown as DbConfig;
const mapping = { sourceByTarget: { id: "id" }, defaults: {} };

const detail = (column_name: string, column_default: string | null): DbColumnMetadata => ({
  column_name,
  data_type: "integer",
  is_nullable: false,
  column_default,
});

const setup = (
  targetConfig: DbConfig | null,
  sourceConfig: DbConfig | null = source,
  targetDetails: DbColumnMetadata[] = []
) =>
  renderHook(() =>
    useFullReplaceWorkflow({
      sourceConfig,
      targetConfig,
      sourceColumns: ["id", "extra"],
      targetColumns: ["id"],
      targetDetails,
      mapping,
    })
  );

const fill = (api: ReturnType<typeof setup>, confirm = "geo.parcels", pw = "pw") => {
  api.act(() => api.result.current.setConfirmValue(confirm));
  api.act(() => api.result.current.setPassword(pw));
};

describe("useFullReplaceWorkflow", () => {
  beforeEach(() => {
    startMock.mockReset();
    h.storeStatus.value = "idle";
  });

  describe("confirmText", () => {
    it("should expose schema.table as the confirmation text", () => {
      const { result } = setup(target("geo"));
      expect(result.current.confirmText).toBe("geo.parcels");
    });

    it("should use public when the target schema is empty", () => {
      const { result } = setup(target(""));
      expect(result.current.confirmText).toBe("public.parcels");
    });

    it("should be empty when there is no target config", () => {
      const { result } = setup(null);
      expect(result.current.confirmText).toBe("");
    });
  });

  describe("canRun gating (AC-4)", () => {
    it("should be false initially", () => {
      const { result } = setup(target("geo"));
      expect(result.current.canRun).toBe(false);
    });

    it("should be false when only the confirmation matches", () => {
      const api = setup(target("geo"));
      api.act(() => api.result.current.setConfirmValue("geo.parcels"));
      expect(api.result.current.canRun).toBe(false);
    });

    it("should be false when only the password is set", () => {
      const api = setup(target("geo"));
      api.act(() => api.result.current.setPassword("pw"));
      expect(api.result.current.canRun).toBe(false);
    });

    it("should be true when confirmation is exact and password non-blank", () => {
      const api = setup(target("geo"));
      fill(api);
      expect(api.result.current.canRun).toBe(true);
    });

    it("should accept public.table when schema is empty", () => {
      const api = setup(target(""));
      fill(api, "public.parcels");
      expect(api.result.current.canRun).toBe(true);
    });

    it("should reject a confirmation that differs only by case", () => {
      const api = setup(target("geo"));
      fill(api, "GEO.parcels");
      expect(api.result.current.canRun).toBe(false);
    });

    it("should reject a confirmation with surrounding whitespace", () => {
      const api = setup(target("geo"));
      fill(api, " geo.parcels ");
      expect(api.result.current.canRun).toBe(false);
    });

    it("should reject a whitespace-only password", () => {
      const api = setup(target("geo"));
      fill(api, "geo.parcels", "   ");
      expect(api.result.current.canRun).toBe(false);
    });

    it("should be false when there is no target config", () => {
      const api = setup(null);
      api.act(() => api.result.current.setPassword("pw"));
      expect(api.result.current.canRun).toBe(false);
    });

    it("should be false when there is no source config", () => {
      const api = setup(target("geo"), null);
      fill(api);
      expect(api.result.current.canRun).toBe(false);
    });

    it("should be false while the store run is running (AC-12)", () => {
      const api = setup(target("geo"));
      fill(api);
      h.storeStatus.value = "running";
      api.rerender();
      expect(api.result.current.isRunning).toBe(true);
      expect(api.result.current.canRun).toBe(false);
    });

    it.each(["idle", "done", "failed"])("should not report running when the store is %s", (status) => {
      h.storeStatus.value = status;
      const { result } = setup(target("geo"));
      expect(result.current.isRunning).toBe(false);
    });
  });

  describe("run", () => {
    it("should not call the store start when gating is not satisfied", () => {
      const api = setup(target("geo"));
      api.act(() => api.result.current.run());
      expect(startMock).not.toHaveBeenCalled();
    });

    it("should not call the store start when the confirmation is wrong", () => {
      const api = setup(target("geo"));
      fill(api, "wrong");
      api.act(() => api.result.current.run());
      expect(startMock).not.toHaveBeenCalled();
      expect(api.result.current.password).toBe("pw");
    });

    it("should not call the store start while a run is already running", () => {
      const api = setup(target("geo"));
      fill(api);
      h.storeStatus.value = "running";
      api.rerender();
      api.act(() => api.result.current.run());
      expect(startMock).not.toHaveBeenCalled();
    });

    it("should call the store start once with configs, columns, mapping and password", () => {
      const tgt = target("geo");
      const api = setup(tgt);
      fill(api, "geo.parcels", "s3cret");
      api.act(() => api.result.current.run());
      expect(startMock).toHaveBeenCalledOnce();
      expect(startMock).toHaveBeenCalledWith({
        sourceConfig: source,
        targetConfig: tgt,
        password: "s3cret",
        sourceColumns: ["id", "extra"],
        targetColumns: ["id"],
        mapping,
        sequences: [],
        resetSequences: true,
      });
    });

    it("should clear the password input after starting (AC-14)", () => {
      const api = setup(target("geo"));
      fill(api);
      api.act(() => api.result.current.run());
      expect(api.result.current.password).toBe("");
      expect(api.result.current.canRun).toBe(false);
    });
  });

  describe("sequence reset", () => {
    const seqDetails = [
      detail("id", "nextval('geo.mapped_seq'::regclass)"),
      detail("seq_id", "nextval('parcels_seq_id_seq'::regclass)"),
      detail("other", "now()"),
    ];
    const mappedSequence = {
      qualifiedLabel: "geo.mapped_seq",
      schema: "geo",
      name: "mapped_seq",
      columns: ["id"],
      mapped: true,
    };
    const expectedSequence = {
      qualifiedLabel: "geo.parcels_seq_id_seq",
      schema: "geo",
      name: "parcels_seq_id_seq",
      columns: ["seq_id"],
      mapped: false,
    };

    it("should discover all sequences from target details including mapped columns flagged as mapped", () => {
      const { result } = setup(target("geo"), source, seqDetails);
      expect(result.current.sequenceDiscovery.sequences).toEqual([mappedSequence, expectedSequence]);
      expect(result.current.sequenceDiscovery.unparsedDefaults).toEqual([]);
    });

    it("should default the reset checkbox to checked", () => {
      const { result } = setup(target("geo"), source, seqDetails);
      expect(result.current.resetSequences).toBe(true);
    });

    it("should pass all discovered sequences and resetSequences true to start when the checkbox is checked", () => {
      const api = setup(target("geo"), source, seqDetails);
      fill(api);
      api.act(() => api.result.current.run());
      expect(startMock).toHaveBeenCalledOnce();
      expect(startMock.mock.calls[0][0].sequences).toEqual([mappedSequence, expectedSequence]);
      expect(startMock.mock.calls[0][0].resetSequences).toBe(true);
    });

    it("should still pass the discovered sequences with resetSequences false when the checkbox is unchecked", () => {
      const api = setup(target("geo"), source, seqDetails);
      api.act(() => api.result.current.setResetSequences(false));
      expect(api.result.current.resetSequences).toBe(false);
      fill(api);
      api.act(() => api.result.current.run());
      expect(startMock.mock.calls[0][0].sequences).toEqual([mappedSequence, expectedSequence]);
      expect(startMock.mock.calls[0][0].resetSequences).toBe(false);
    });

    it("should pass an empty sequences array to start when no sequences are discoverable", () => {
      const api = setup(target("geo"), source, [detail("id", null), detail("other", "now()")]);
      expect(api.result.current.sequenceDiscovery.sequences).toEqual([]);
      fill(api);
      api.act(() => api.result.current.run());
      expect(startMock.mock.calls[0][0].sequences).toEqual([]);
      expect(startMock.mock.calls[0][0].resetSequences).toBe(true);
    });

    it("should qualify unqualified sequences with public when the target schema is empty", () => {
      const api = setup(target(""), source, [detail("seq_id", "nextval('s1'::regclass)")]);
      expect(api.result.current.sequenceDiscovery.sequences[0]).toMatchObject({ schema: "public", name: "s1" });
    });

    it("should expose unparsable defaults for the warning", () => {
      const { result } = setup(target("geo"), source, [detail("seq_id", "nextval(foo)")]);
      expect(result.current.sequenceDiscovery.unparsedDefaults).toEqual(["seq_id: nextval(foo)"]);
    });

    it("should discover nothing when there is no target config and no details", () => {
      const { result } = setup(null);
      expect(result.current.sequenceDiscovery.sequences).toEqual([]);
    });
  });

  describe("showPassword", () => {
    it("should toggle visibility", () => {
      const api = setup(target("geo"));
      expect(api.result.current.showPassword).toBe(false);
      api.act(() => api.result.current.toggleShowPassword());
      expect(api.result.current.showPassword).toBe(true);
    });
  });
});
