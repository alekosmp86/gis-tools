import { describe, expect, it } from "vitest";
import { EMPTY_CELL, formatCell, pluralize } from "@/modules/address-dedup/domain/rowFormat";
import {
  GROUP_TABLE_COLUMN_COUNT,
  GROUP_TABLE_COLUMNS,
  MATCH_KEY_COLUMNS,
} from "@/modules/address-dedup/data/dedupLabels";

describe("formatCell", () => {
  it("should return the raw value untouched", () => {
    // Arrange & Act & Assert
    expect(formatCell(" Artigas ")).toBe(" Artigas ");
    expect(formatCell("0")).toBe("0");
  });

  it.each([null, "", "   "])("should render %j as an em dash", (value) => {
    // Arrange & Act & Assert
    expect(formatCell(value)).toBe(EMPTY_CELL);
    expect(formatCell(value)).not.toContain("null");
  });
});

describe("group table columns", () => {
  it("should derive the column count from the labels: source, urn, every key column, decision, reason", () => {
    // Arrange & Act & Assert
    expect(MATCH_KEY_COLUMNS).toHaveLength(15);
    expect(GROUP_TABLE_COLUMN_COUNT).toBe(GROUP_TABLE_COLUMNS.length);
    expect(GROUP_TABLE_COLUMN_COUNT).toBe(MATCH_KEY_COLUMNS.length + 4);
  });

  it("should list the key columns in match_key order between urn and decision", () => {
    // Arrange & Act & Assert
    expect(MATCH_KEY_COLUMNS.map((column) => column.field)).toEqual([
      "province",
      "province_code",
      "raw_rs_censal_locality_code",
      "locality",
      "postal_code",
      "padron_locality_or_geo",
      "street_name",
      "street_number",
      "letter",
      "square",
      "sandlot",
      "km",
      "padron",
      "type_padron",
      "rs_reftramo",
    ]);
    expect(GROUP_TABLE_COLUMNS.slice(0, 2)).toEqual(["Fuente", "URN"]);
    expect(GROUP_TABLE_COLUMNS.slice(-2)).toEqual(["Decisión", "Motivo"]);
  });

  it("should have unique labels", () => {
    // Arrange & Act & Assert
    expect(new Set(GROUP_TABLE_COLUMNS).size).toBe(GROUP_TABLE_COLUMNS.length);
  });
});

describe("pluralize", () => {
  it.each([
    [0, "filas"],
    [1, "fila"],
    [2, "filas"],
    [1200, "filas"],
  ])("should pick the right form for %i", (count, expected) => {
    // Arrange & Act & Assert
    expect(pluralize(count, "fila", "filas")).toBe(expected);
  });
});
