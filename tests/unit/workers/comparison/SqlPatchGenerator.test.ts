import { describe, it, expect } from "vitest";
import { SqlPatchGenerator } from "@/workers/comparison/SqlPatchGenerator";
import { DiscrepancyType, type ColumnMappingConfig, type DiscrepancyItem } from "@/types/comparison";

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
});
