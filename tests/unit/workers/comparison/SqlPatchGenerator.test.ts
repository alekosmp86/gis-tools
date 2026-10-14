import { describe, it, expect } from "vitest";
import { SqlPatchGenerator, isUnkeyedPairedItem } from "@/core/workers/comparison/SqlPatchGenerator";
import {
  DiscrepancyType,
  PairingMethod,
  type ColumnMappingConfig,
  type DiscrepancyItem,
} from "@/core/types/comparison";

describe("SqlPatchGenerator", () => {
  const baseMapping: ColumnMappingConfig = {
    suidColumns: ["suid_col"],
    matchedFileSuidColumns: ["file_suid"],
    fieldsToCompare: ["nombre", "depto"],
    attributeMap: { nombre: "file_nombre", depto: "file_depto" },
    compareGeometry: false,
  };

  it("should generate UPDATE statements for ATTRIBUTE_MISMATCH discrepancies", () => {
    // Arrange
    const generator = new SqlPatchGenerator({
      dbSchemaName: "public",
      dbTableName: "localidades",
      mappingConfig: baseMapping,
    });

    const discrepancies: DiscrepancyItem[] = [
      {
        id: "1",
        suid: "LOC_01",
        type: DiscrepancyType.ATTRIBUTE_MISMATCH,
        differences: [
          {
            fieldName: "nombre",
            dbValue: "VIEJO",
            shpValue: "NUEVO",
          },
        ],
        dbRecord: {
          suid_col: "LOC_01",
          nombre: "VIEJO",
        },
      },
    ];

    // Act
    const patchSummary = generator.generatePatches(discrepancies, undefined, true);

    // Assert
    expect(patchSummary.sqlUpdateCount).toBe(1);
    expect(patchSummary.sqlInsertCount).toBe(0);
    expect(patchSummary.sqlUpdateScript).toContain('UPDATE "public"."localidades"');
    expect(patchSummary.sqlUpdateScript).toContain('"nombre" = \'NUEVO\'');
    expect(patchSummary.sqlUpdateScript).toContain('WHERE "suid_col" = \'LOC_01\'');
  });

  it("should use primaryKeyColumn optimization in WHERE clause when enabled", () => {
    // Arrange
    const pkMapping: ColumnMappingConfig = {
      ...baseMapping,
      primaryKeyColumn: "id_pk",
    };

    const generator = new SqlPatchGenerator({
      dbSchemaName: "gis",
      dbTableName: "parcelas",
      mappingConfig: pkMapping,
    });

    const discrepancies: DiscrepancyItem[] = [
      {
        id: "2",
        suid: "COMPOSITE_SUID",
        type: DiscrepancyType.ATTRIBUTE_MISMATCH,
        differences: [
          {
            fieldName: "depto",
            dbValue: "MONTEVIDEO",
            shpValue: "CANELONES",
          },
        ],
        dbRecord: {
          id_pk: 9999,
          suid_col: "COMPOSITE_SUID",
          depto: "MONTEVIDEO",
        },
      },
    ];

    // Act
    const patchSummary = generator.generatePatches(discrepancies, undefined, true);

    // Assert
    expect(patchSummary.sqlUpdateCount).toBe(1);
    expect(patchSummary.sqlUpdateScript).toContain('WHERE "id_pk" = 9999');
  });

  it("should generate INSERT statements with insertDefaults for ONLY_IN_SHP records", () => {
    // Arrange
    const insertMapping: ColumnMappingConfig = {
      ...baseMapping,
      insertDefaults: {
        created_at: { fieldName: "created_at", value: "CURRENT_TIMESTAMP", useRawExpression: true },
        estado: { fieldName: "estado", value: "ACTIVO", useRawExpression: false },
      },
    };

    const generator = new SqlPatchGenerator({
      dbSchemaName: "public",
      dbTableName: "puntos",
      mappingConfig: insertMapping,
    });

    const discrepancies: DiscrepancyItem[] = [
      {
        id: "3",
        suid: "NEW_SUID_55",
        type: DiscrepancyType.ONLY_IN_SHP,
        differences: [],
        shpFeatureProps: {
          file_suid: "NEW_SUID_55",
          file_nombre: "NUEVO PUNTO",
          file_depto: "ROCHA",
        },
      },
    ];

    // Act
    const patchSummary = generator.generatePatches(discrepancies, undefined, true);

    // Assert
    expect(patchSummary.sqlInsertCount).toBe(1);
    expect(patchSummary.sqlInsertScript).toContain('INSERT INTO "public"."puntos"');
    expect(patchSummary.sqlInsertScript).toContain("CURRENT_TIMESTAMP");
    expect(patchSummary.sqlInsertScript).toContain("'ACTIVO'");
  });

  describe("unkeyed paired rows guard", () => {
    const pairing = { method: PairingMethod.GEOMETRY, dbCount: 2, fileCount: 2, distance: 0 };
    const pairedItem = (dbRecord: Record<string, unknown> | undefined): DiscrepancyItem => ({
      id: "match-K-1",
      suid: "K",
      type: DiscrepancyType.ATTRIBUTE_MISMATCH,
      differences: [{ fieldName: "nombre", dbValue: "VIEJO", shpValue: "NUEVO" }],
      dbRecord,
      pairing,
    });
    const generatorFor = (primaryKeyColumn?: string) =>
      new SqlPatchGenerator({
        dbSchemaName: "public",
        dbTableName: "localidades",
        mappingConfig: { ...baseMapping, primaryKeyColumn },
      });

    describe("isUnkeyedPairedItem", () => {
      it("should return false for an item without pairing", () => {
        // Arrange
        const item = { ...pairedItem({ suid_col: "K" }), pairing: undefined };

        // Act / Assert
        expect(isUnkeyedPairedItem(item, undefined)).toBe(false);
        expect(isUnkeyedPairedItem(item, "id_pk")).toBe(false);
      });

      it("should return true for a paired item when no primary key column is configured", () => {
        // Act / Assert
        expect(isUnkeyedPairedItem(pairedItem({ id_pk: 5 }), undefined)).toBe(true);
        expect(isUnkeyedPairedItem(pairedItem({ id_pk: 5 }), null)).toBe(true);
        expect(isUnkeyedPairedItem(pairedItem({ id_pk: 5 }), "")).toBe(true);
      });

      it("should return true for a paired item whose primary key value is null or missing", () => {
        // Act / Assert
        expect(isUnkeyedPairedItem(pairedItem({ id_pk: null }), "id_pk")).toBe(true);
        expect(isUnkeyedPairedItem(pairedItem({ suid_col: "K" }), "id_pk")).toBe(true);
        expect(isUnkeyedPairedItem(pairedItem(undefined), "id_pk")).toBe(true);
      });

      it("should return false for a paired item carrying a primary key value, including 0", () => {
        // Act / Assert
        expect(isUnkeyedPairedItem(pairedItem({ id_pk: 5 }), "id_pk")).toBe(false);
        expect(isUnkeyedPairedItem(pairedItem({ id_pk: 0 }), "id_pk")).toBe(false);
      });
    });

    it("should emit no UPDATE for a paired item without a primary key value (full script)", () => {
      // Act
      const summary = generatorFor().generatePatches([pairedItem({ suid_col: "K" })], undefined, true);

      // Assert
      expect(summary.sqlUpdateCount).toBe(0);
      expect(summary.sqlUpdateScript).toBe("");
    });

    it("should emit no UPDATE when the primary key column is configured but the row lacks its value", () => {
      // Act
      const summary = generatorFor("id_pk").generatePatches(
        [pairedItem({ suid_col: "K", id_pk: null })],
        undefined,
        true
      );

      // Assert
      expect(summary.sqlUpdateCount).toBe(0);
    });

    it("should exclude unkeyed paired items from preview-only totals and previews", () => {
      // Arrange
      const items = [pairedItem({ suid_col: "K" }), pairedItem({ suid_col: "K2", id_pk: 7 })];

      // Act
      const summary = generatorFor("id_pk").generatePatches(items, undefined, false);

      // Assert
      expect(summary.sqlUpdateCount).toBe(1);
      expect(summary.sqlUpdatePreview).toContain('WHERE "id_pk" = 7');
      expect(summary.sqlUpdatePreview.split("\n")).toHaveLength(1);
    });

    it("should emit exactly one UPDATE with the primary key WHERE for a paired item that has one", () => {
      // Act
      const summary = generatorFor("id_pk").generatePatches(
        [pairedItem({ suid_col: "K", id_pk: 42 })],
        undefined,
        true
      );

      // Assert
      expect(summary.sqlUpdateCount).toBe(1);
      expect(summary.sqlUpdateScript).toContain('WHERE "id_pk" = 42');
      expect(summary.sqlUpdateScript).not.toContain('"suid_col" =');
    });

    it("should still emit the composite-SUID UPDATE for a non-paired item without a primary key", () => {
      // Arrange
      const item = { ...pairedItem({ suid_col: "K" }), pairing: undefined };

      // Act
      const summary = generatorFor().generatePatches([item], undefined, true);

      // Assert
      expect(summary.sqlUpdateCount).toBe(1);
      expect(summary.sqlUpdateScript).toContain('WHERE "suid_col" = \'K\'');
    });

    it("should generate an INSERT for a leftover file row of a colliding key", () => {
      // Arrange
      const leftover: DiscrepancyItem = {
        id: "file-K-1",
        suid: "K",
        type: DiscrepancyType.ONLY_IN_SHP,
        differences: [],
        shpFeatureProps: { file_suid: "K", file_nombre: "SOBRANTE", file_depto: "ROCHA" },
      };

      // Act
      const summary = generatorFor().generatePatches([leftover], undefined, true);

      // Assert
      expect(summary.sqlInsertCount).toBe(1);
      expect(summary.sqlInsertScript).toContain('INSERT INTO "public"."localidades"');
      expect(summary.sqlInsertScript).toContain("'SOBRANTE'");
    });
  });
});
