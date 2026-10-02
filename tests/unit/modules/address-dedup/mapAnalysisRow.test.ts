import { describe, expect, it } from "vitest";
import { mapAnalysisRow } from "@/modules/address-dedup/services/queries/mapAnalysisRow";

function rawPgRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    group_id: "3",
    fuente: "ANTEL",
    urn: "cgeo:Antel:address:id:1",
    lat: "-33.461795",
    lng: "-56.730707",
    km: null,
    matched_serv_cto_tlk: true,
    matched_nap_physical_device: false,
    dup_group_size: "2",
    n_matched_in_group: "1",
    pool_rank_in_group: "1",
    decision: "KEEP",
    decision_reason: "INFRA_MATCHED",
    id_province: 7,
    ...overrides,
  };
}

describe("mapAnalysisRow", () => {
  it("should coerce the string numbers pg returns for bigint and numeric columns", () => {
    // Arrange & Act
    const row = mapAnalysisRow(rawPgRow());

    // Assert
    expect(row.group_id).toBe(3);
    expect(row.dup_group_size).toBe(2);
    expect(row.n_matched_in_group).toBe(1);
    expect(row.pool_rank_in_group).toBe(1);
    expect(row.lat).toBe(-33.461795);
    expect(row.lng).toBe(-56.730707);
    for (const value of [row.group_id, row.dup_group_size, row.n_matched_in_group, row.pool_rank_in_group, row.lat, row.lng]) {
      expect(typeof value).toBe("number");
    }
  });

  it("should map null coordinates and a null rank to null", () => {
    // Arrange & Act
    const row = mapAnalysisRow(rawPgRow({ lat: null, lng: null, pool_rank_in_group: null }));

    // Assert
    expect(row.lat).toBeNull();
    expect(row.lng).toBeNull();
    expect(row.pool_rank_in_group).toBeNull();
  });

  it("should map a NaN coordinate string to null", () => {
    // Arrange & Act
    const row = mapAnalysisRow(rawPgRow({ lat: "NaN", lng: "NaN" }));

    // Assert
    expect(row.lat).toBeNull();
    expect(row.lng).toBeNull();
  });

  it("should keep a null km as null and stringify a numeric km", () => {
    // Arrange & Act
    const withoutKm = mapAnalysisRow(rawPgRow({ km: null }));
    const withKm = mapAnalysisRow(rawPgRow({ km: "12.5" }));

    // Assert
    expect(withoutKm.km).toBeNull();
    expect(withKm.km).toBe("12.5");
  });

  it("should pass boolean flags through as booleans", () => {
    // Arrange & Act
    const row = mapAnalysisRow(rawPgRow());

    // Assert
    expect(row.matched_serv_cto_tlk).toBe(true);
    expect(row.matched_nap_physical_device).toBe(false);
  });

  it("should map the match key columns", () => {
    // Arrange & Act
    const row = mapAnalysisRow(
      rawPgRow({
        province_code: "UY-FL",
        padron_locality: "TRINIDAD",
        padron_locality_or_geo: "TRINIDAD",
        match_key: "FLORES|UY-FL",
      })
    );

    // Assert
    expect(row.province_code).toBe("UY-FL");
    expect(row.padron_locality).toBe("TRINIDAD");
    expect(row.padron_locality_or_geo).toBe("TRINIDAD");
    expect(row.match_key).toBe("FLORES|UY-FL");
  });

  it("should keep missing match key columns as null, never the text null", () => {
    // Arrange & Act
    const row = mapAnalysisRow(
      rawPgRow({ province_code: null, padron_locality: null, padron_locality_or_geo: undefined })
    );

    // Assert
    expect(row.province_code).toBeNull();
    expect(row.padron_locality).toBeNull();
    expect(row.padron_locality_or_geo).toBeNull();
    expect(row.match_key).toBe("");
  });

  it.each([null, undefined])("should map a %s fuente and urn to an empty string, never the text 'null'", (missing) => {
    // Arrange & Act
    const row = mapAnalysisRow(rawPgRow({ fuente: missing, urn: missing }));

    // Assert
    expect(row.fuente).toBe("");
    expect(row.urn).toBe("");
  });
});
