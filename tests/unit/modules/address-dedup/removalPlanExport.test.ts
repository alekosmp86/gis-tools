import { describe, expect, it } from "vitest";
import {
  buildRemovalPlanCsv,
  buildRemovalPlanFilename,
  buildTargetUrnText,
} from "@/modules/address-dedup/domain/removalPlanExport";

const TARGETS = [
  { urn: "cgeo:Antel:address:id:2", fuente: "ANTEL" },
  { urn: "cgeo:TLK:wstlk:id:3", fuente: "TLK" },
];

describe("removal plan export", () => {
  describe("buildRemovalPlanCsv", () => {
    it("should write the header and one CRLF-terminated line per target", () => {
      // Arrange & Act
      const csv = buildRemovalPlanCsv(TARGETS);

      // Assert
      expect(csv).toBe("urn,fuente\r\ncgeo:Antel:address:id:2,ANTEL\r\ncgeo:TLK:wstlk:id:3,TLK\r\n");
    });

    it("should write only the header for an empty plan", () => {
      // Arrange & Act & Assert
      expect(buildRemovalPlanCsv([])).toBe("urn,fuente\r\n");
    });

    it("should quote cells holding commas, quotes or line breaks and double the quotes", () => {
      // Arrange
      const targets = [
        { urn: 'urn,with"quote', fuente: "AN\nTEL" },
        { urn: " padded ", fuente: "" },
      ];

      // Act
      const csv = buildRemovalPlanCsv(targets);

      // Assert
      expect(csv).toBe('urn,fuente\r\n"urn,with""quote","AN\nTEL"\r\n" padded ",\r\n');
    });
  });

  describe("buildTargetUrnText", () => {
    it("should join the urns with newlines and leave the fuente out", () => {
      expect(buildTargetUrnText(TARGETS)).toBe("cgeo:Antel:address:id:2\ncgeo:TLK:wstlk:id:3");
    });

    it("should be empty for an empty plan", () => {
      expect(buildTargetUrnText([])).toBe("");
    });
  });

  describe("buildRemovalPlanFilename", () => {
    it("should carry the province and the first eight characters of the fingerprint", () => {
      expect(buildRemovalPlanFilename(7, "0123456789abcdef0123456789abcdef")).toBe(
        "address-dedup-removal-plan-7-01234567.csv"
      );
    });
  });
});
