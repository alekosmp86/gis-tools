import { describe, expect, it } from "vitest";
import { AvanceFileKind } from "@/modules/coverage-loads/avance-ftth/constants";
import { detectFileKind, parseAvanceFileName } from "@/modules/coverage-loads/avance-ftth/domain/fileName";
import { assignFileSlots, isCompletePair } from "@/modules/coverage-loads/avance-ftth/domain/fileSlots";

describe("avance-ftth file names (AC-1)", () => {
  describe("accepted names", () => {
    it.each([
      ["SituacionFTTH_INT_21092026.csv", AvanceFileKind.INT, "21092026"],
      ["SituacionFTTH_UDPEM_21092026.csv", AvanceFileKind.UDPEM, "21092026"],
      ["SituacionFTTH_INT_01012026.csv", AvanceFileKind.INT, "01012026"],
      ["SituacionFTTH_UDPEM_31122026.csv", AvanceFileKind.UDPEM, "31122026"],
      ["SituacionFTTH_INT_29022028.csv", AvanceFileKind.INT, "29022028"],
      ["SituacionFTTH_INT_29022000.csv", AvanceFileKind.INT, "29022000"],
    ])("should accept %s as %s with fechaact %s", (fileName, kind, fechaact) => {
      // Arrange & Act
      const result = parseAvanceFileName(fileName);

      // Assert
      expect(result).toEqual({ ok: true, kind, fechaact });
    });
  });

  describe("rejected names", () => {
    it.each([
      ["wrong prefix", "SituacionFTTH_XXX_21092026.csv"],
      ["indicators file", "IndicadoresLTE_20260901.csv"],
      ["no prefix", "21092026.csv"],
      ["lower case prefix", "situacionftth_int_21092026.csv"],
      ["7 digits", "SituacionFTTH_INT_2109202.csv"],
      ["9 digits", "SituacionFTTH_INT_210920266.csv"],
      ["no digits", "SituacionFTTH_INT_.csv"],
      ["letters in the date", "SituacionFTTH_INT_21ab2026.csv"],
      ["non calendar day 31 of February", "SituacionFTTH_INT_31022026.csv"],
      ["29 of February in a non leap year", "SituacionFTTH_INT_29022026.csv"],
      ["29 of February in the century year 1900", "SituacionFTTH_INT_29021900.csv"],
      ["day zero", "SituacionFTTH_INT_00092026.csv"],
      ["month 13", "SituacionFTTH_INT_01132026.csv"],
      ["month zero", "SituacionFTTH_INT_01002026.csv"],
      ["day 31 of a 30 day month", "SituacionFTTH_UDPEM_31042026.csv"],
      ["year zero", "SituacionFTTH_INT_01010000.csv"],
      ["wrong extension", "SituacionFTTH_INT_21092026.txt"],
      ["no extension", "SituacionFTTH_INT_21092026"],
      ["upper case extension", "SituacionFTTH_INT_21092026.CSV"],
      ["double extension", "SituacionFTTH_INT_21092026.csv.csv"],
      ["trailing space", "SituacionFTTH_INT_21092026.csv "],
      ["leading space", " SituacionFTTH_INT_21092026.csv"],
      ["forward slash path", "dir/SituacionFTTH_INT_21092026.csv"],
      ["backslash path", "C:\\dir\\SituacionFTTH_INT_21092026.csv"],
      ["traversal path", "../SituacionFTTH_INT_21092026.csv"],
      ["empty name", ""],
    ])("should reject %s", (_label, fileName) => {
      // Arrange & Act
      const result = parseAvanceFileName(fileName);

      // Assert
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.message).toContain(`"${fileName}"`);
        expect(result.message).toContain("SituacionFTTH_INT_ddmmaaaa.csv");
        expect(result.message).toContain("SituacionFTTH_UDPEM_ddmmaaaa.csv");
      }
    });
  });

  describe("detectFileKind", () => {
    it.each([
      ["SituacionFTTH_INT_21092026.csv", AvanceFileKind.INT],
      ["SituacionFTTH_UDPEM_anything.csv", AvanceFileKind.UDPEM],
      ["SituacionFTTH_INT_31022026.csv", AvanceFileKind.INT],
      ["otra.csv", null],
      ["", null],
    ])("should detect %j from the prefix alone as %s", (fileName, kind) => {
      // Arrange & Act & Assert
      expect(detectFileKind(fileName)).toBe(kind);
    });
  });

  describe("file slots (the browser side of AC-1)", () => {
    const fileNamed = (name: string) => new File(["x"], name);

    it("should place each file by its name and report the unrecognised ones", () => {
      // Arrange
      const files = [fileNamed("SituacionFTTH_UDPEM_21092026.csv"), fileNamed("notas.csv"), fileNamed("SituacionFTTH_INT_21092026.csv")];

      // Act
      const { slots, unrecognized } = assignFileSlots(files);

      // Assert
      expect(slots[AvanceFileKind.INT].map((file) => file.name)).toEqual(["SituacionFTTH_INT_21092026.csv"]);
      expect(slots[AvanceFileKind.UDPEM].map((file) => file.name)).toEqual(["SituacionFTTH_UDPEM_21092026.csv"]);
      expect(unrecognized.map((file) => file.name)).toEqual(["notas.csv"]);
    });

    it("should call a pair complete only with exactly one file of each kind and nothing else", () => {
      // Arrange
      const interior = fileNamed("SituacionFTTH_INT_21092026.csv");
      const montevideo = fileNamed("SituacionFTTH_UDPEM_21092026.csv");

      // Act & Assert
      expect(isCompletePair([interior, montevideo])).toBe(true);
      expect(isCompletePair([interior])).toBe(false);
      expect(isCompletePair([])).toBe(false);
      expect(isCompletePair([interior, interior])).toBe(false);
      expect(isCompletePair([interior, montevideo, fileNamed("otro.csv")])).toBe(false);
      expect(isCompletePair([interior, montevideo, fileNamed("SituacionFTTH_INT_22092026.csv")])).toBe(false);
    });
  });
});
