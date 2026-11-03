import { describe, expect, it } from "vitest";
import { DESTINATION_COLUMN } from "@/modules/routine-jobs/jobs/actualizar-padron/constants";
import type { TableLayout } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/layouts";
import { optionalAddressMasterColumn } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/revertCapture";
import type { WritableTargetLayout } from "@/modules/routine-jobs/jobs/shared/tableResolution";

const identity = (columns: readonly string[]): Record<string, string> => Object.fromEntries(columns.map((column) => [column, column]));

const tableOf = (schema: string, table: string, columns: readonly string[]): TableLayout => ({
  schema,
  table,
  columns: identity(columns),
});

const BASE_TARGET: WritableTargetLayout = {
  ...tableOf("carto", "padron", Object.values(DESTINATION_COLUMN)),
  srid: 32721,
  idColumn: "id",
  idSequence: "carto.padron_id_seq",
  identityColumns: [],
  catalog: [],
};

describe("optionalAddressMasterColumn (AP-106)", () => {
  it("should resolve the physical column via target.columns when the catalog role already required it (the link option was on)", () => {
    const target: WritableTargetLayout = {
      ...BASE_TARGET,
      columns: { ...BASE_TARGET.columns, id_address_master: "id_address_master" },
    };

    expect(optionalAddressMasterColumn(target)).toBe('"id_address_master"');
  });

  it("should fall back to a direct catalog lookup when the link option was off, so the column was never required but still exists", () => {
    const target: WritableTargetLayout = {
      ...BASE_TARGET,
      catalog: [{ column_name: "id_address_master", data_type: "integer", column_default: null, is_nullable: true }],
    };

    expect(optionalAddressMasterColumn(target)).toBe('"id_address_master"');
  });

  it("should prefer the resolved logical column over the catalog when both are present", () => {
    const target: WritableTargetLayout = {
      ...BASE_TARGET,
      columns: { ...BASE_TARGET.columns, id_address_master: "id_address_master" },
      catalog: [{ column_name: "id_address_master", data_type: "integer", column_default: null, is_nullable: true }],
    };

    expect(optionalAddressMasterColumn(target)).toBe('"id_address_master"');
  });

  it("should return null when the destination genuinely has no id_address_master column, resolved or in the catalog", () => {
    expect(optionalAddressMasterColumn(BASE_TARGET)).toBeNull();
  });
});
