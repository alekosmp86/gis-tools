import { describe, it, expect } from "vitest";
import {
  formatDateSuggestion,
  isDateLikeType,
  pickDatasetModifiedAt,
} from "@/core/services/fileDateSuggestion";

const OLDER = new Date(2024, 0, 10, 8, 0, 0);
const NEWER = new Date(2024, 5, 1, 9, 30, 0);
const NEWEST = new Date(2025, 2, 3, 17, 45, 0);

describe("fileDateSuggestion", () => {
  describe("pickDatasetModifiedAt", () => {
    describe("data entries", () => {
      it("should return the newest .shp or .dbf date when both are present", () => {
        const entryDates = new Map<string, Date>([
          ["lotes.shp", OLDER],
          ["lotes.dbf", NEWER],
        ]);
        expect(pickDatasetModifiedAt(entryDates, null)).toEqual(NEWER);
      });

      it("should ignore a .prj or .xml entry that is newer than the data entries", () => {
        const entryDates = new Map<string, Date>([
          ["lotes.shp", OLDER],
          ["lotes.dbf", NEWER],
          ["lotes.prj", NEWEST],
          ["lotes.xml", NEWEST],
        ]);
        expect(pickDatasetModifiedAt(entryDates, null)).toEqual(NEWER);
      });

      it("should return the .shp date when it is the only data entry", () => {
        const entryDates = new Map<string, Date>([
          ["lotes.shp", OLDER],
          ["lotes.prj", NEWEST],
        ]);
        expect(pickDatasetModifiedAt(entryDates, null)).toEqual(OLDER);
      });

      it("should ignore names that contain .shp or .dbf without ending in it", () => {
        const entryDates = new Map<string, Date>([
          ["lotes.shp.bak", NEWEST],
          ["lotes.dbf.old", NEWEST],
          ["shp", NEWEST],
          ["lotes.shp", OLDER],
        ]);
        expect(pickDatasetModifiedAt(entryDates, null)).toEqual(OLDER);
      });

      it("should return the entry date rather than a newer fallback when a data entry exists", () => {
        const entryDates = new Map<string, Date>([["lotes.shp", OLDER]]);
        expect(pickDatasetModifiedAt(entryDates, NEWEST)).toEqual(OLDER);
      });
    });

    describe("fallback", () => {
      it("should return the fallback when the map holds only non-data entries", () => {
        const entryDates = new Map<string, Date>([
          ["lotes.prj", NEWEST],
          ["lotes.shx", NEWEST],
        ]);
        expect(pickDatasetModifiedAt(entryDates, OLDER)).toEqual(OLDER);
      });

      it("should return the fallback when the map is empty", () => {
        expect(pickDatasetModifiedAt(new Map(), OLDER)).toEqual(OLDER);
      });
    });

    describe("null results", () => {
      it("should return null when the map is empty and there is no fallback", () => {
        expect(pickDatasetModifiedAt(new Map(), null)).toBeNull();
      });

      it("should return null when no data entry exists and there is no fallback", () => {
        const entryDates = new Map<string, Date>([["lotes.prj", NEWEST]]);
        expect(pickDatasetModifiedAt(entryDates, null)).toBeNull();
      });
    });
  });

  describe("formatDateSuggestion", () => {
    describe("timestamp types", () => {
      it("should format a timestamp as YYYY-MM-DD HH:MM:SS with zero-padded fields", () => {
        expect(formatDateSuggestion(new Date(2024, 0, 5, 3, 4, 5), "timestamp")).toBe("2024-01-05 03:04:05");
      });

      it("should format midnight as 00:00:00", () => {
        expect(formatDateSuggestion(new Date(2024, 2, 15, 0, 0, 0), "timestamp")).toBe("2024-03-15 00:00:00");
      });

      it("should format the last second of the day as 23:59:59", () => {
        expect(formatDateSuggestion(new Date(2024, 2, 15, 23, 59, 59), "timestamp")).toBe("2024-03-15 23:59:59");
      });

      it("should include the time for 'timestamp without time zone'", () => {
        expect(
          formatDateSuggestion(new Date(2024, 2, 15, 13, 7, 9), "timestamp without time zone")
        ).toBe("2024-03-15 13:07:09");
      });

      it("should include the time for 'timestamp with time zone'", () => {
        expect(
          formatDateSuggestion(new Date(2024, 2, 15, 13, 7, 9), "timestamp with time zone")
        ).toBe("2024-03-15 13:07:09");
      });

      it("should include the time for an upper-case TIMESTAMP WITHOUT TIME ZONE type", () => {
        expect(
          formatDateSuggestion(new Date(2024, 2, 15, 13, 7, 9), "TIMESTAMP WITHOUT TIME ZONE")
        ).toBe("2024-03-15 13:07:09");
      });
    });

    describe("date and other types", () => {
      it("should format a date type as YYYY-MM-DD without a time", () => {
        expect(formatDateSuggestion(new Date(2024, 2, 15, 13, 7, 9), "date")).toBe("2024-03-15");
      });

      it("should zero-pad a single-digit month and day for a date type", () => {
        expect(formatDateSuggestion(new Date(2009, 8, 7, 12, 0, 0), "date")).toBe("2009-09-07");
      });

      it.each(["text", "interval", "time", "integer"])(
        "should format the date only for the non-date type %s",
        (dataType) => {
          expect(formatDateSuggestion(new Date(2024, 2, 15, 13, 7, 9), dataType)).toBe("2024-03-15");
        }
      );
    });
  });

  describe("isDateLikeType", () => {
    describe("date-like types", () => {
      it.each([
        "date",
        "DATE",
        "timestamp",
        "Timestamp",
        "timestamp with time zone",
        "timestamp without time zone",
        "TIMESTAMP WITHOUT TIME ZONE",
      ])("should return true for %s", (dataType) => {
        expect(isDateLikeType(dataType)).toBe(true);
      });
    });

    describe("non date-like types", () => {
      it.each(["interval", "time", "time with time zone", "time without time zone", "text", "integer", "numeric"])(
        "should return false for %s",
        (dataType) => {
          expect(isDateLikeType(dataType)).toBe(false);
        }
      );

      it("should return false when the data type is undefined", () => {
        expect(isDateLikeType(undefined)).toBe(false);
      });

      it("should return false when the data type is an empty string", () => {
        expect(isDateLikeType("")).toBe(false);
      });
    });
  });
});
