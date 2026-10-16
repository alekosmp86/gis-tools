import { describe, it, expect, vi, beforeEach } from "vitest";

/** buildComparisonKey is not exported: observe it through the key handed to useDiscrepancySelection. */
const h = vi.hoisted(() => {
  const slots: unknown[] = [];
  let idx = 0;
  return {
    keys: [] as string[],
    reset() {
      slots.length = 0;
      idx = 0;
      this.keys.length = 0;
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

vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), useState: h.useState }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/hooks/useDatasetComparison", () => ({
  useDatasetComparison: () => ({
    summary: undefined,
    loading: false,
    isBusy: false,
    customNotice: null,
    error: null,
    progress: { phase: "", current: 0, total: 0, pct: 0 },
  }),
}));
vi.mock("@/hooks/useDiscrepancyGeojson", () => ({ useDiscrepancyGeojson: () => null }));
vi.mock("@/components/tools/db-sync-common/discrepancies-table/useDiscrepancySelection", () => ({
  useDiscrepancySelection: (p: { comparisonKey: string }) => {
    h.keys.push(p.comparisonKey);
    return {
      selectedIds: new Set<string>(),
      selectableCount: 0,
      selectionVersion: 0,
      toggle: () => undefined,
      select: () => undefined,
      deselect: () => undefined,
      clear: () => undefined,
    };
  },
}));

import { ComparisonResultsView } from "@/components/tools/db-sync-common/ComparisonResultsView";
import type { DbConfig } from "@/core/types/db";

const db = (over: Partial<DbConfig> = {}) =>
  ({ db_name: "d", schema_name: "s", table_name: "t", ...over }) as unknown as DbConfig;

const fileDataset = { fileName: "f.csv" } as never;
const mappingConfig = {
  suidColumns: ["a"],
  fieldsToCompare: ["b"],
  compareGeometry: false,
  treatPlaceholdersAsEmpty: false,
  ignoreEncodingArtifacts: false,
} as never;

function keyFor(dbConfig: DbConfig, sourceDbConfig?: DbConfig): string {
  h.reset();
  h.begin();
  ComparisonResultsView({ dbConfig, fileDataset, mappingConfig, sourceDbConfig });
  return h.keys[0];
}

beforeEach(() => h.reset());

describe("ComparisonResultsView comparison key", () => {
  it("should produce an identical key for identical inputs", () => {
    expect(keyFor(db(), db())).toBe(keyFor(db(), db()));
  });

  it("should change the key when dbConfig.schema_name changes", () => {
    expect(keyFor(db({ schema_name: "s1" }))).not.toBe(keyFor(db({ schema_name: "s2" })));
  });

  it("should change the key when sourceDbConfig.schema_name changes", () => {
    expect(keyFor(db(), db({ schema_name: "s1" }))).not.toBe(keyFor(db(), db({ schema_name: "s2" })));
  });

  it("should change the key when dbConfig.table_name changes", () => {
    expect(keyFor(db({ table_name: "t1" }))).not.toBe(keyFor(db({ table_name: "t2" })));
  });
});
