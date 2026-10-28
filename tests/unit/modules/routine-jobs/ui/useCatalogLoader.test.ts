import { describe, expect, it, vi } from "vitest";
import { useCatalogLoader } from "@/modules/routine-jobs/ui/useCatalogLoader";
import { RoutineJobsApiError, type RoutineJobsClient } from "@/modules/routine-jobs/ui/routineJobsClient";
import type { ClientConnection } from "@/modules/routine-jobs/ui/clientTypes";
import type { TableListing } from "@/core/types/tableCatalog";

/** No DOM/renderHook lib installed: react hooks are replaced by a minimal slot-based shim (same pattern as the db-sync hooks). */
const shim = vi.hoisted(() => {
  const slots: unknown[] = [];
  const depSlots: Array<readonly unknown[] | undefined> = [];
  let index = 0;
  let dirty = false;
  const sameDeps = (left: readonly unknown[] | undefined, right: readonly unknown[]): boolean =>
    left !== undefined && left.length === right.length && left.every((value, position) => Object.is(value, right[position]));
  return {
    reset() {
      slots.length = 0;
      depSlots.length = 0;
      index = 0;
      dirty = false;
    },
    begin() {
      index = 0;
    },
    takeDirty(): boolean {
      const was = dirty;
      dirty = false;
      return was;
    },
    useState<T>(init: T | (() => T)) {
      const slot = index++;
      if (!(slot in slots)) slots[slot] = typeof init === "function" ? (init as () => T)() : init;
      const set = (value: T | ((previous: T) => T)) => {
        const next = typeof value === "function" ? (value as (previous: T) => T)(slots[slot] as T) : value;
        if (!Object.is(next, slots[slot])) dirty = true;
        slots[slot] = next;
      };
      return [slots[slot] as T, set] as const;
    },
    useMemo<T>(factory: () => T, deps: readonly unknown[]): T {
      const slot = index++;
      if (!sameDeps(depSlots[slot], deps)) {
        slots[slot] = factory();
        depSlots[slot] = deps;
      }
      return slots[slot] as T;
    },
  };
});

vi.mock("react", () => ({ useState: shim.useState, useMemo: shim.useMemo }));

function renderHook<R>(hook: () => R) {
  shim.reset();
  const result = { current: undefined as unknown as R };
  const render = () => {
    shim.begin();
    result.current = hook();
  };
  const rerender = () => {
    render();
    while (shim.takeDirty()) render();
  };
  rerender();
  return { result, rerender };
}

const CONNECTION: ClientConnection = { host: " db.local ", port: "5432", db_name: "gis", user: "carto", password: "pw" };
const LISTING: TableListing = { schemaExists: true, tables: [{ name: "t", kind: "TABLE" }] } as TableListing;

const listTablesOf = (behaviour: (schema: string) => Promise<TableListing>) => {
  const listTables = vi.fn(async (_connection: unknown, schema: string) => behaviour(schema));
  return { client: { listTables } as unknown as Pick<RoutineJobsClient, "listTables">, listTables };
};

describe("useCatalogLoader", () => {
  it("should list the tables of a schema with the trimmed connection and return the listing", async () => {
    const { client, listTables } = listTablesOf(async () => LISTING);
    const { result } = renderHook(() => useCatalogLoader(client, CONNECTION));

    await expect(result.current.loadTables(" carto ")).resolves.toEqual(LISTING);
    expect(listTables).toHaveBeenCalledWith(expect.objectContaining({ host: "db.local" }), "carto");
  });

  it("should remember a connection failure for its schema and report it through catalogErrorFor", async () => {
    const { client } = listTablesOf(async () => {
      throw new RoutineJobsApiError("No se pudo conectar con el servidor.", 503);
    });
    const { result, rerender } = renderHook(() => useCatalogLoader(client, CONNECTION));

    await expect(result.current.loadTables("carto")).rejects.toThrow("No se pudo conectar con el servidor.");
    rerender();
    expect(result.current.catalogErrorFor(["carto"])).toBe("No se pudo conectar con el servidor.");
  });

  it("should not record an error that is not a connection failure", async () => {
    const { client } = listTablesOf(async () => {
      throw new RoutineJobsApiError("Esquema no válido.", 400);
    });
    const { result, rerender } = renderHook(() => useCatalogLoader(client, CONNECTION));

    await expect(result.current.loadTables("carto")).rejects.toThrow("Esquema no válido.");
    rerender();
    expect(result.current.catalogErrorFor(["carto"])).toBeNull();
  });

  it("should clear the remembered error of a schema once its listing succeeds", async () => {
    let failing = true;
    const { client } = listTablesOf(async () => {
      if (failing) throw new RoutineJobsApiError("Servidor caído.", 500);
      return LISTING;
    });
    const { result, rerender } = renderHook(() => useCatalogLoader(client, CONNECTION));
    await expect(result.current.loadTables("carto")).rejects.toThrow();
    rerender();
    expect(result.current.catalogErrorFor(["carto"])).toBe("Servidor caído.");

    failing = false;
    await result.current.loadTables("carto");
    rerender();

    expect(result.current.catalogErrorFor(["carto"])).toBeNull();
  });

  it("should report only the errors of the schemas asked for, in the order asked", async () => {
    const { client } = listTablesOf(async (schema) => {
      throw new RoutineJobsApiError(`Fallo en ${schema}.`, 503);
    });
    const { result, rerender } = renderHook(() => useCatalogLoader(client, CONNECTION));
    await expect(result.current.loadTables("x")).rejects.toThrow();
    rerender();
    await expect(result.current.loadTables("y")).rejects.toThrow();
    rerender();

    expect(result.current.catalogErrorFor(["y", "x"])).toBe("Fallo en y.");
    expect(result.current.catalogErrorFor(["otro"])).toBeNull();
  });

  it("should forget every remembered error when reset is called", async () => {
    const { client } = listTablesOf(async () => {
      throw new RoutineJobsApiError("Servidor caído.", 503);
    });
    const { result, rerender } = renderHook(() => useCatalogLoader(client, CONNECTION));
    await expect(result.current.loadTables("carto")).rejects.toThrow();
    rerender();

    result.current.reset();
    rerender();

    expect(result.current.catalogErrorFor(["carto"])).toBeNull();
  });
});
