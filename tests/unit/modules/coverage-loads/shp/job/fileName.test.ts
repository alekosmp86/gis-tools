import { describe, expect, it } from "vitest";
import { parseShpFileName } from "@/modules/coverage-loads/shp/job/fileName.ts";

describe("parseShpFileName", () => {
  it.each([
    ["NRUruguay", "cobertura5g"],
    ["WCDMAUruguay", "wcdma"],
    ["NBIoTUruguay", "nbiot"],
    ["LTEUruguay", "lte"],
  ])("should map prefix %s to table %s when the name is valid", (prefix, table) => {
    const result = parseShpFileName(`${prefix}_20260131.shp`);

    expect(result).toEqual({ ok: true, prefix, table, fechaact: "2026-01-31" });
  });

  it("should reject the name when the prefix case differs", () => {
    expect(parseShpFileName("lteuruguay_20260131.shp").ok).toBe(false);
    expect(parseShpFileName("LteUruguay_20260131.shp").ok).toBe(false);
  });

  it("should reject the extension when it is uppercase .SHP", () => {
    expect(parseShpFileName("LTEUruguay_20260131.SHP").ok).toBe(false);
  });

  it.each([
    ["leap year divisible by 4", "LTEUruguay_20240229.shp", true],
    ["leap year divisible by 400", "LTEUruguay_20000229.shp", true],
    ["century non-leap year", "LTEUruguay_19000229.shp", false],
    ["non-leap year", "LTEUruguay_20230229.shp", false],
    ["Feb 28 non-leap", "LTEUruguay_20230228.shp", true],
    ["Feb 30 leap", "LTEUruguay_20240230.shp", false],
  ])("should handle February 29 when %s", (_label, name, ok) => {
    expect(parseShpFileName(name).ok).toBe(ok);
  });

  it.each([
    ["month 00", "LTEUruguay_20260001.shp"],
    ["month 13", "LTEUruguay_20261301.shp"],
    ["day 00", "LTEUruguay_20260100.shp"],
    ["day 32", "LTEUruguay_20260132.shp"],
    ["31 April", "LTEUruguay_20260431.shp"],
    ["31 September", "LTEUruguay_20260931.shp"],
    ["year 0000", "LTEUruguay_00000101.shp"],
  ])("should reject the date when it has %s", (_label, name) => {
    expect(parseShpFileName(name).ok).toBe(false);
  });

  it("should accept year 0001 when the rest is a valid date", () => {
    const result = parseShpFileName("LTEUruguay_00010101.shp");

    expect(result).toEqual({ ok: true, prefix: "LTEUruguay", table: "lte", fechaact: "0001-01-01" });
  });

  it("should accept day 31 in a 31-day month and day 30 in April", () => {
    expect(parseShpFileName("LTEUruguay_20260131.shp").ok).toBe(true);
    expect(parseShpFileName("LTEUruguay_20260430.shp").ok).toBe(true);
  });

  it.each([
    ["wrong prefix", "FooUruguay_20260131.shp"],
    ["missing date", "LTEUruguay_.shp"],
    ["missing underscore", "LTEUruguay20260131.shp"],
    ["7 digits", "LTEUruguay_2026013.shp"],
    ["9 digits", "LTEUruguay_202601311.shp"],
    ["extra chars before", "xLTEUruguay_20260131.shp"],
    ["extra chars after", "LTEUruguay_20260131.shp.bak"],
    ["wrong extension", "LTEUruguay_20260131.csv"],
    ["empty", ""],
    ["path traversal", "../LTEUruguay_20260131.shp"],
    ["trailing newline", "LTEUruguay_20260131.shp\n"],
  ])("should reject the name when it has %s", (_label, name) => {
    expect(parseShpFileName(name).ok).toBe(false);
  });

  it("should return a Spanish message naming the file when the name is invalid", () => {
    const result = parseShpFileName("malo.shp");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('"malo.shp"');
      expect(result.message).toContain("no tiene un nombre válido");
      expect(result.message).toContain("NRUruguay");
    }
  });
});
