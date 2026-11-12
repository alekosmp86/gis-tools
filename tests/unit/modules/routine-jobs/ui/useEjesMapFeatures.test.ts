import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EjesGeometryMapBase } from "@/modules/routine-jobs/ui/clientTypes";
import { subjectOfTwin } from "@/modules/routine-jobs/ui/ejesMapSubject";
import { useEjesMapFeatures } from "@/modules/routine-jobs/ui/useEjesMapFeatures";

const calls = vi.hoisted(() => ({
  scopes: [] as string[],
  fetchers: [] as Array<(items: unknown[]) => Promise<unknown>>,
  fetchEjesGeometryMap: vi.fn(async () => []),
}));

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useCallback: <T>(callback: T): T => callback,
}));

vi.mock("@/modules/routine-jobs/ui/map/useOutlineMapFeatures", () => ({
  useOutlineMapFeatures: (_items: unknown, scope: string, fetchOutlines: (items: unknown[]) => Promise<unknown>) => {
    calls.scopes.push(scope);
    calls.fetchers.push(fetchOutlines);
    return { status: "loading", features: [] };
  },
}));

vi.mock("@/modules/routine-jobs/ui/routineJobsClient", () => ({
  createRoutineJobsClient: () => ({ fetchEjesGeometryMap: calls.fetchEjesGeometryMap }),
}));

const baseOf = (padrones: { schema: string; table: string }): EjesGeometryMapBase => ({
  connection: { host: "db.local", port: "5432", db_name: "gis", user: "gis_user", password: "pw" },
  tables: {
    "ejes-origen": { schema: "bdj_carto", table: "ide_ejesviacirculacion" },
    "ejes-tramos": { schema: "carto", table: "road_section" },
    "ejes-padrones": padrones,
  },
});

const SUBJECT = subjectOfTwin({
  ref: "1",
  idcalle: "2",
  department: "FLORES",
  localities: ["A", "B"],
  class: "URBAN",
  length: 10,
  urbanLength: 5,
  ruralLength: 0,
  dropLocalities: [],
});

describe("useEjesMapFeatures scope (ET-8)", () => {
  beforeEach(() => {
    calls.scopes.length = 0;
    calls.fetchers.length = 0;
    calls.fetchEjesGeometryMap.mockClear();
  });

  it("should include the padrones table in the cache scope, so another padrones table never reuses an outline", () => {
    useEjesMapFeatures(SUBJECT, baseOf({ schema: "carto", table: "padron" }));
    useEjesMapFeatures(SUBJECT, baseOf({ schema: "carto", table: "padron_2025" }));

    expect(calls.scopes[0]).toContain("carto|padron");
    expect(calls.scopes[0]).not.toBe(calls.scopes[1]);
    expect(calls.scopes[1]).toContain("padron_2025");
  });

  it("should give the same scope for the same connection and tables", () => {
    useEjesMapFeatures(SUBJECT, baseOf({ schema: "carto", table: "padron" }));
    useEjesMapFeatures(SUBJECT, baseOf({ schema: "carto", table: "padron" }));

    expect(calls.scopes[0]).toBe(calls.scopes[1]);
  });

  it("should send the base, with the padrones table, and the items to the map request", async () => {
    const base = baseOf({ schema: "carto", table: "padron" });
    useEjesMapFeatures(SUBJECT, base);

    await calls.fetchers[0](SUBJECT.items);

    expect(calls.fetchEjesGeometryMap).toHaveBeenCalledWith({ ...base, items: SUBJECT.items });
  });
});
