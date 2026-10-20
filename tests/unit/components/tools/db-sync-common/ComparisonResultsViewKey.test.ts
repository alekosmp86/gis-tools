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

interface KeyInputs {
  dbConfig: DbConfig;
  sourceDbConfig?: DbConfig;
  fileName: string;
  mapping: Record<string, unknown>;
}

const baseMapping = () => ({
  suidColumns: ["a"],
  fieldsToCompare: ["b"],
  compareGeometry: false,
  treatPlaceholdersAsEmpty: false,
  ignoreEncodingArtifacts: false,
});

const baseInputs = (): KeyInputs => ({
  dbConfig: db(),
  sourceDbConfig: db(),
  fileName: "f.csv",
  mapping: baseMapping(),
});

function keyOf(over: Partial<KeyInputs> = {}, mappingOver: Record<string, unknown> = {}): string {
  const inputs = { ...baseInputs(), ...over };
  h.reset();
  h.begin();
  ComparisonResultsView({
    dbConfig: inputs.dbConfig,
    sourceDbConfig: inputs.sourceDbConfig,
    fileDataset: { fileName: inputs.fileName } as never,
    mappingConfig: { ...inputs.mapping, ...mappingOver } as never,
  });
  return h.keys[0];
}

beforeEach(() => h.reset());

describe("ComparisonResultsView comparison key", () => {
  it("should produce an identical key for identical inputs", () => {
    expect(keyOf()).toBe(keyOf());
  });

  const changing: Array<[string, () => string]> = [
    ["dbConfig.db_name", () => keyOf({ dbConfig: db({ db_name: "other" }) })],
    ["dbConfig.schema_name", () => keyOf({ dbConfig: db({ schema_name: "other" }) })],
    ["dbConfig.table_name", () => keyOf({ dbConfig: db({ table_name: "other" }) })],
    ["sourceDbConfig.db_name", () => keyOf({ sourceDbConfig: db({ db_name: "other" }) })],
    ["sourceDbConfig.schema_name", () => keyOf({ sourceDbConfig: db({ schema_name: "other" }) })],
    ["sourceDbConfig.table_name", () => keyOf({ sourceDbConfig: db({ table_name: "other" }) })],
    ["sourceDbConfig presence", () => keyOf({ sourceDbConfig: undefined })],
    ["fileDataset.fileName", () => keyOf({ fileName: "other.csv" })],
    ["mappingConfig.suidColumns", () => keyOf({}, { suidColumns: ["a", "c"] })],
    ["mappingConfig.fieldsToCompare", () => keyOf({}, { fieldsToCompare: ["b", "c"] })],
    ["mappingConfig.compareGeometry", () => keyOf({}, { compareGeometry: true })],
    ["mappingConfig.treatPlaceholdersAsEmpty", () => keyOf({}, { treatPlaceholdersAsEmpty: true })],
    ["mappingConfig.ignoreEncodingArtifacts", () => keyOf({}, { ignoreEncodingArtifacts: true })],
  ];

  it.each(changing)("should change the key when %s changes", (_field, changedKey) => {
    expect(changedKey()).not.toBe(keyOf());
  });

  it("should distinguish suidColumns order and content", () => {
    expect(keyOf({}, { suidColumns: ["a", "b"] })).not.toBe(keyOf({}, { suidColumns: ["b", "a"] }));
  });

  const ignored: Array<[string, () => string]> = [
    ["mappingConfig.primaryKeyColumn", () => keyOf({}, { primaryKeyColumn: "gid" })],
    ["dbConfig.host", () => keyOf({ dbConfig: db({ host: "elsewhere" } as Partial<DbConfig>) })],
    ["dbConfig.password", () => keyOf({ dbConfig: db({ password: "secret" } as Partial<DbConfig>) })],
    ["sourceDbConfig.user", () => keyOf({ sourceDbConfig: db({ user: "someone" } as Partial<DbConfig>) })],
  ];

  it.each(ignored)("should keep the same key when %s changes", (_field, sameKey) => {
    expect(sameKey()).toBe(keyOf());
  });
});
