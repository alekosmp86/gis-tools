import { describe, it, expect, vi } from "vitest";
import { resolveUnitTypeId } from "@/modules/routine-jobs/jobs/unidad-territorial/services/preflight";
import type { CatalogQuerySession } from "@/core/services/server/tableCatalog/tableCatalog";
import type { TableLayout } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/layouts";
import { UNIT_TYPE_COLUMN } from "@/modules/routine-jobs/jobs/unidad-territorial/constants";

const TYPE_NAME = "LOCALIDAD CATASTRAL";
const TYPE_ID = 7;

const typeLayout: TableLayout = {
  schema: "carto",
  table: "tipo_unidad",
  columns: Object.fromEntries(Object.values(UNIT_TYPE_COLUMN).map((column) => [column, column])),
};

function sessionAnswering(rows: Record<string, unknown>[]) {
  const query = vi.fn<(sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>>(async () => ({ rows }));
  const session = { query } as unknown as CatalogQuerySession;
  return { session, query };
}

describe("resolveUnitTypeId", () => {
  describe("exactly-one rule", () => {
    it("should return the id when exactly one row of the type name exists", async () => {
      const { session } = sessionAnswering([{ matches: 1, id: TYPE_ID }]);

      const unitTypeId = await resolveUnitTypeId(session, typeLayout, TYPE_NAME);

      expect(unitTypeId).toBe(TYPE_ID);
    });

    it("should reject when no row of the type name exists", async () => {
      const { session } = sessionAnswering([{ matches: 0, id: null }]);

      await expect(resolveUnitTypeId(session, typeLayout, TYPE_NAME)).rejects.toThrow(
        new RegExp(`El tipo "${TYPE_NAME}" aparece 0 veces .*debe aparecer exactamente una vez`)
      );
    });

    it("should reject as zero matches when the count row is missing entirely", async () => {
      const { session } = sessionAnswering([]);

      await expect(resolveUnitTypeId(session, typeLayout, TYPE_NAME)).rejects.toThrow(/aparece 0 veces/);
    });

    it("should reject when two rows share the type name, never picking one of them", async () => {
      const { session } = sessionAnswering([{ matches: 2, id: 3 }]);

      await expect(resolveUnitTypeId(session, typeLayout, TYPE_NAME)).rejects.toThrow(/aparece 2 veces/);
    });

    it("should reject when the matched id is not a safe integer", async () => {
      const { session } = sessionAnswering([{ matches: 1, id: "no-entero" }]);

      await expect(resolveUnitTypeId(session, typeLayout, TYPE_NAME)).rejects.toThrow(/no es un entero válido/);
    });
  });

  describe("query shape", () => {
    it("should bind the type name as a parameter and never interpolate it into the SQL", async () => {
      const { session, query } = sessionAnswering([{ matches: 1, id: TYPE_ID }]);

      await resolveUnitTypeId(session, typeLayout, TYPE_NAME);

      const [sql, values] = query.mock.calls[0];
      expect(sql).not.toContain(TYPE_NAME);
      expect(values).toEqual([TYPE_NAME]);
    });
  });
});
