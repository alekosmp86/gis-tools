import { describe, expect, it } from "vitest";
import { mapProvinceRow } from "@/modules/address-dedup/services/queries/mapProvinceRow";

describe("mapProvinceRow", () => {
  it("should keep a numeric id and the name", () => {
    // Arrange & Act
    const province = mapProvinceRow({ id: 7, name: "FLORES" });

    // Assert
    expect(province).toEqual({ id: 7, name: "FLORES" });
  });

  it("should coerce a string id, as pg returns int8 and numeric columns", () => {
    // Arrange & Act
    const province = mapProvinceRow({ id: "19", name: "TREINTA Y TRES" });

    // Assert
    expect(province.id).toBe(19);
  });

  it("should map a non-numeric id to 0, as mapAnalysisRow does for a required number", () => {
    // Arrange & Act
    const province = mapProvinceRow({ id: "abc", name: "X" });

    // Assert
    expect(province.id).toBe(0);
  });

  it("should map a null id to 0 and fall back to the id as name", () => {
    // Arrange & Act
    const province = mapProvinceRow({ id: null, name: null });

    // Assert
    expect(province).toEqual({ id: 0, name: "0" });
  });

  it.each([null, undefined, "", "   "])("should fall back to the id as name for %j", (name) => {
    // Arrange & Act
    const province = mapProvinceRow({ id: 7, name });

    // Assert
    expect(province).toEqual({ id: 7, name: "7" });
  });
});
