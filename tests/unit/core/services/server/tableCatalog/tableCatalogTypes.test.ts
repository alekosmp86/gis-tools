import { describe, expect, it } from "vitest";
import * as serverCatalog from "@/core/services/server/tableCatalog/tableCatalog";
import * as sharedCatalog from "@/core/types/tableCatalog";
import type { ColumnStatus, ResolvedColumn, TableKind, TableListing } from "@/core/types/tableCatalog";

describe("tableCatalog shared types", () => {
  it("AC-3b: should export the TableKind value object with its expected values", () => {
    expect(sharedCatalog.TableKind).toEqual({ TABLE: "TABLE", VIEW: "VIEW" });
  });

  it("AC-3b: should export the ColumnStatus value object with its expected values", () => {
    expect(sharedCatalog.ColumnStatus).toEqual({
      RESOLVED: "resolved",
      MISSING: "missing",
      AMBIGUOUS: "ambiguous",
    });
  });

  it("AC-3b: should keep the server module exporting listTables and resolveColumns", () => {
    expect(typeof serverCatalog.listTables).toBe("function");
    expect(typeof serverCatalog.resolveColumns).toBe("function");
  });

  it("AC-3b: should type listings and columns with the shared names", () => {
    const kind: TableKind = sharedCatalog.TableKind.VIEW;
    const status: ColumnStatus = sharedCatalog.ColumnStatus.AMBIGUOUS;
    const column: ResolvedColumn = { logical: "gid", status, column: "gid" };
    const listing: TableListing = { schemaExists: true, tables: [{ name: "t", kind }] };

    expect(column.status).toBe("ambiguous");
    expect(listing.tables[0].kind).toBe("VIEW");
  });
});
