import { describe, it, expect } from "vitest";
import {
  columnRows,
  describeListing,
  isConnectionFailure,
  isCurrentAnswer,
  isSelectionValid,
  shouldShowListError,
  type SelectorLoadState,
} from "@/ui-kit/components/tableSelectorLogic";
import type { ResolvedColumn, TableListing } from "@/core/types/tableCatalog";

const listing = (overrides: Partial<TableListing> = {}): TableListing => ({
  schemaExists: true,
  tables: [
    { name: "rural_2024", kind: "TABLE" },
    { name: "v_urbano", kind: "VIEW" },
    { name: "padron_destino", kind: "TABLE" },
  ],
  ...overrides,
});

const resolved = (logical: string, column = logical, dataType?: string): ResolvedColumn => ({
  logical,
  status: "resolved",
  column,
  ...(dataType ? { dataType } : {}),
});

describe("tableSelectorLogic", () => {
  describe("describeListing", () => {
    it("AC-3b: should return no options and no message when idle", () => {
      const view = describeListing({ phase: "idle" }, []);

      expect(view).toEqual({ options: [], message: null });
    });

    it("AC-3b: should show the loading message and no options while loading", () => {
      const view = describeListing({ phase: "loading", schema: "carto" }, []);

      expect(view.message).toBe("Cargando tablas...");
      expect(view.options).toEqual([]);
    });

    it("AC-3b: should show the error text and no options when the load failed", () => {
      const view = describeListing({ phase: "error", error: "No se pudo conectar con el servidor." }, []);

      expect(view.message).toBe("No se pudo conectar con el servidor.");
      expect(view.options).toEqual([]);
    });

    it("AC-3b: should still show some non-empty message when the load failed without error text", () => {
      const view = describeListing({ phase: "error" }, []);

      expect(typeof view.message).toBe("string");
      expect((view.message ?? "").trim().length).toBeGreaterThan(0);
    });

    it("AC-3b: should say the schema does not exist when the listing reports schemaExists false", () => {
      const view = describeListing(
        { phase: "ready", schema: "carto", listing: { schemaExists: false, tables: [] } },
        [],
      );

      expect(view.message).toBe('El esquema "carto" no existe.');
      expect(view.options).toEqual([]);
    });

    it("AC-3b: should say the schema has no tables when the listing is empty", () => {
      const view = describeListing({ phase: "ready", schema: "carto", listing: listing({ tables: [] }) }, []);

      expect(view.message).toBe('El esquema "carto" no tiene tablas.');
      expect(view.options).toEqual([]);
    });

    it("AC-3b: should list tables in the given order with no message when ready", () => {
      const view = describeListing({ phase: "ready", schema: "carto", listing: listing() }, []);

      expect(view.message).toBeNull();
      expect(view.options.map((option) => option.name)).toEqual(["rural_2024", "v_urbano", "padron_destino"]);
      expect(view.options.every((option) => option.disabled === false)).toBe(true);
    });

    it("AC-3b: should label tables with their plain name and views with the (vista) suffix", () => {
      const view = describeListing({ phase: "ready", schema: "carto", listing: listing() }, []);

      expect(view.options.map((option) => option.label)).toEqual(["rural_2024", "v_urbano (vista)", "padron_destino"]);
    });

    it("AC-3b: should disable excluded tables without changing their label", () => {
      const view = describeListing({ phase: "ready", schema: "carto", listing: listing() }, [
        "rural_2024",
        "v_urbano",
      ]);

      expect(view.options).toEqual([
        { name: "rural_2024", label: "rural_2024", disabled: true },
        { name: "v_urbano", label: "v_urbano (vista)", disabled: true },
        { name: "padron_destino", label: "padron_destino", disabled: false },
      ]);
    });

    it("AC-3b: should match excluded tables exactly and case-sensitively", () => {
      const view = describeListing({ phase: "ready", schema: "carto", listing: listing() }, ["RURAL_2024"]);

      expect(view.options.every((option) => option.disabled === false)).toBe(true);
    });

    it("AC-3b: should not throw and show no options when ready without a listing", () => {
      const view = describeListing({ phase: "ready", schema: "carto" }, []);

      expect(view.options).toEqual([]);
    });
  });

  describe("columnRows", () => {
    it("AC-3b: should return no rows for an empty list", () => {
      expect(columnRows([])).toEqual([]);
    });

    it("AC-3b: should report a resolved column with its real name", () => {
      const rows = columnRows([resolved("padron", "PADRON")]);

      expect(rows).toEqual([{ logical: "padron", ok: true, statusLabel: "Encontrada", detail: "PADRON" }]);
    });

    it("AC-3b: should append the data type to a resolved column when it is known", () => {
      const rows = columnRows([resolved("areaha", "area_ha", "numeric")]);

      expect(rows[0].detail).toBe("area_ha · numeric");
      expect(rows[0].ok).toBe(true);
    });

    it("AC-3b: should report a missing column with the suggestion when there is one", () => {
      const rows = columnRows([{ logical: "nomdepto", status: "missing", suggestion: "nom_depto" }]);

      expect(rows).toEqual([
        { logical: "nomdepto", ok: false, statusLabel: "Falta", detail: "Sugerencia: nom_depto" },
      ]);
    });

    it("AC-3b: should report a missing column without suggestion as not existing in the table", () => {
      const rows = columnRows([{ logical: "geom", status: "missing" }]);

      expect(rows).toEqual([{ logical: "geom", ok: false, statusLabel: "Falta", detail: "No existe en la tabla" }]);
    });

    it("AC-3b: should report an ambiguous column as not ok with an explanation", () => {
      const rows = columnRows([{ logical: "padron", status: "ambiguous" }]);

      expect(rows[0].ok).toBe(false);
      expect(rows[0].statusLabel).toBe("Ambigua");
      expect(rows[0].detail.trim().length).toBeGreaterThan(0);
      expect(rows[0].detail).not.toBe("No existe en la tabla");
    });

    it("AC-3b: should keep the order and mix of statuses of the input", () => {
      const rows = columnRows([
        resolved("gid"),
        { logical: "geom", status: "missing" },
        { logical: "padron", status: "ambiguous" },
      ]);

      expect(rows.map((row) => row.logical)).toEqual(["gid", "geom", "padron"]);
      expect(rows.map((row) => row.ok)).toEqual([true, false, false]);
    });
  });

  describe("isSelectionValid", () => {
    it("AC-3b: should not be valid for an empty column list", () => {
      expect(isSelectionValid([])).toBe(false);
    });

    it("AC-3b: should be valid when every column is resolved", () => {
      expect(isSelectionValid([resolved("gid"), resolved("geom")])).toBe(true);
    });

    it("AC-3b: should not be valid when one column is missing", () => {
      expect(isSelectionValid([resolved("gid"), { logical: "geom", status: "missing" }])).toBe(false);
    });

    it("AC-3b: should not be valid when one column is ambiguous", () => {
      expect(isSelectionValid([resolved("gid"), { logical: "geom", status: "ambiguous" }])).toBe(false);
    });

    it("AC-3b: should not be valid when every column is missing", () => {
      expect(isSelectionValid([{ logical: "gid", status: "missing" }])).toBe(false);
    });
  });

  describe("isConnectionFailure", () => {
    it.each([0, 500, 502, 503, 599])("AC-3b: should treat status %i as a connection failure", (status) => {
      expect(isConnectionFailure(status)).toBe(true);
    });

    it.each([400, 401, 403, 404, 422, 499])("AC-3b: should not treat client error %i as a connection failure", (status) => {
      expect(isConnectionFailure(status)).toBe(false);
    });

    it.each([200, 204, 301])("AC-3b: should not treat status %i as a connection failure", (status) => {
      expect(isConnectionFailure(status)).toBe(false);
    });
  });

  describe("isCurrentAnswer", () => {
    it("AC-3b: should accept an answer for the schema that is still the latest", () => {
      expect(isCurrentAnswer("carto", "carto")).toBe(true);
    });

    it("AC-3b: should reject an answer for a schema that is no longer the latest", () => {
      expect(isCurrentAnswer("carto", "otro")).toBe(false);
    });

    it("AC-3b: should reject an answer when the latest schema is empty", () => {
      expect(isCurrentAnswer("carto", "")).toBe(false);
    });

    it("AC-3b: should compare exactly, without trimming or ignoring case", () => {
      expect(isCurrentAnswer("carto", "carto ")).toBe(false);
      expect(isCurrentAnswer("carto", "Carto")).toBe(false);
    });
  });

  describe("shouldShowListError", () => {
    const NON_ERROR_PHASES: Array<SelectorLoadState["phase"]> = ["idle", "loading", "ready"];

    it("AC-3b: should show the list error when the phase is error and hideListError is undefined", () => {
      expect(shouldShowListError("error", undefined)).toBe(true);
    });

    it("AC-3b: should show the list error when the phase is error and hideListError is false", () => {
      expect(shouldShowListError("error", false)).toBe(true);
    });

    it("AC-3b: should hide the list error when the phase is error and hideListError is true", () => {
      expect(shouldShowListError("error", true)).toBe(false);
    });

    it.each(NON_ERROR_PHASES)("AC-3b: should never show a list error in the %s phase", (phase) => {
      expect(shouldShowListError(phase, undefined)).toBe(false);
      expect(shouldShowListError(phase, false)).toBe(false);
      expect(shouldShowListError(phase, true)).toBe(false);
    });
  });
});
