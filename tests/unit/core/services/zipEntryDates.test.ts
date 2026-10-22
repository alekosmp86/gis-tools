import { describe, it, expect } from "vitest";
import { readZipEntryDates } from "@/core/binary/zipEntryDates";
import { buildStoredZip, type StoredZipEntry } from "../binary/support/storedZip";

const encoder = new TextEncoder();
const EOCD_BYTES = 22;
const CENTRAL_HEADER_FIXED_BYTES = 46;
const EOCD_CENTRAL_OFFSET_FIELD = 16;

const entry = (name: string, modified: Date): StoredZipEntry => ({
  name,
  data: encoder.encode(`content of ${name}`),
  modified,
});

const withoutSecondCentralHeader = (zip: Uint8Array, firstName: string): Uint8Array => {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const eocdOffset = zip.length - EOCD_BYTES;
  const centralStart = view.getUint32(eocdOffset + EOCD_CENTRAL_OFFSET_FIELD, true);
  const firstHeaderEnd = centralStart + CENTRAL_HEADER_FIXED_BYTES + encoder.encode(firstName).length;
  return new Uint8Array([...zip.slice(0, firstHeaderEnd), ...zip.slice(eocdOffset)]);
};

describe("zipEntryDates", () => {
  describe("readZipEntryDates", () => {
    describe("entry dates", () => {
      it("should return the local date of an entry when its DOS time has whole even seconds", () => {
        const zip = buildStoredZip([entry("roads.shp", new Date(2024, 2, 15, 13, 7, 8))]);
        const dates = readZipEntryDates(zip);
        expect(dates.get("roads.shp")).toEqual(new Date(2024, 2, 15, 13, 7, 8));
      });

      it("should round odd seconds down to the 2-second DOS resolution", () => {
        const zip = buildStoredZip([entry("roads.shp", new Date(2024, 2, 15, 13, 7, 9))]);
        const dates = readZipEntryDates(zip);
        expect(dates.get("roads.shp")).toEqual(new Date(2024, 2, 15, 13, 7, 8));
      });

      it("should read the last representable second of the day without rolling over", () => {
        const zip = buildStoredZip([entry("late.dbf", new Date(2023, 11, 31, 23, 59, 58))]);
        const dates = readZipEntryDates(zip);
        expect(dates.get("late.dbf")).toEqual(new Date(2023, 11, 31, 23, 59, 58));
      });

      it("should read a midnight DOS time as 00:00:00 on the stored day", () => {
        const zip = buildStoredZip([entry("midnight.shp", new Date(2000, 0, 1, 0, 0, 0))]);
        const dates = readZipEntryDates(zip);
        expect(dates.get("midnight.shp")).toEqual(new Date(2000, 0, 1, 0, 0, 0));
      });

      it("should read the date of each entry independently when the archive has several entries", () => {
        const zip = buildStoredZip([
          entry("a.shp", new Date(2021, 4, 10, 9, 15, 30)),
          entry("a.dbf", new Date(2022, 6, 20, 18, 45, 12)),
          entry("a.prj", new Date(2019, 10, 3, 1, 2, 4)),
        ]);
        const dates = readZipEntryDates(zip);
        expect(dates.size).toBe(3);
        expect(dates.get("a.shp")).toEqual(new Date(2021, 4, 10, 9, 15, 30));
        expect(dates.get("a.dbf")).toEqual(new Date(2022, 6, 20, 18, 45, 12));
        expect(dates.get("a.prj")).toEqual(new Date(2019, 10, 3, 1, 2, 4));
      });
    });

    describe("entry names", () => {
      it("should lowercase entry names when building the map keys", () => {
        const zip = buildStoredZip([entry("Calles.SHP", new Date(2024, 0, 2, 3, 4, 6))]);
        const dates = readZipEntryDates(zip);
        expect([...dates.keys()]).toEqual(["calles.shp"]);
        expect(dates.get("calles.shp")).toEqual(new Date(2024, 0, 2, 3, 4, 6));
      });

      it("should keep the stored folder path in the lowercased key", () => {
        const zip = buildStoredZip([entry("Capas/Lotes.dbf", new Date(2024, 0, 2, 3, 4, 6))]);
        const dates = readZipEntryDates(zip);
        expect(dates.get("capas/lotes.dbf")).toEqual(new Date(2024, 0, 2, 3, 4, 6));
      });
    });

    describe("empty and malformed input", () => {
      it("should return an empty map when the input is an empty array", () => {
        expect(readZipEntryDates(new Uint8Array(0)).size).toBe(0);
      });

      it("should return an empty map when the input is not a zip archive", () => {
        expect(readZipEntryDates(encoder.encode("esto no es un zip")).size).toBe(0);
      });

      it("should return an empty map when the archive is a valid zip with no entries", () => {
        expect(readZipEntryDates(buildStoredZip([])).size).toBe(0);
      });

      it.each([1, 10, EOCD_BYTES, 40])(
        "should return an empty map when the last %i bytes of the archive are cut off",
        (cutBytes) => {
          const zip = buildStoredZip([entry("a.shp", new Date(2024, 2, 15, 13, 7, 8))]);
          expect(readZipEntryDates(zip.slice(0, zip.length - cutBytes)).size).toBe(0);
        }
      );

      it("should return an empty map when the central directory is cut short but the end record is intact", () => {
        const zip = buildStoredZip([
          entry("a.shp", new Date(2024, 2, 15, 13, 7, 8)),
          entry("b.dbf", new Date(2024, 2, 15, 13, 7, 10)),
        ]);
        const corrupted = withoutSecondCentralHeader(zip, "a.shp");
        expect(readZipEntryDates(corrupted).size).toBe(0);
      });

      it("should return an empty map when the end record points past the end of the archive", () => {
        const zip = buildStoredZip([entry("a.shp", new Date(2024, 2, 15, 13, 7, 8))]);
        const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
        view.setUint32(zip.length - EOCD_BYTES + EOCD_CENTRAL_OFFSET_FIELD, zip.length + 1000, true);
        expect(readZipEntryDates(zip).size).toBe(0);
      });

      it("should return an empty map and not throw when the input is a lone end-of-central-directory record", () => {
        const lone = new Uint8Array(EOCD_BYTES);
        new DataView(lone.buffer).setUint32(0, 0x06054b50, true);
        expect(() => readZipEntryDates(lone)).not.toThrow();
        expect(readZipEntryDates(lone).size).toBe(0);
      });

      it("should not throw for arbitrary byte sequences", () => {
        const noise = Uint8Array.from({ length: 300 }, (_, index) => (index * 37 + 11) % 256);
        expect(() => readZipEntryDates(noise)).not.toThrow();
        expect(readZipEntryDates(noise).size).toBe(0);
      });
    });

    describe("zip64 archives", () => {
      it("should return an empty map when the end record carries the zip64 offset marker", () => {
        const zip = buildStoredZip([entry("a.shp", new Date(2024, 2, 15, 13, 7, 8))]);
        const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
        view.setUint32(zip.length - EOCD_BYTES + EOCD_CENTRAL_OFFSET_FIELD, 0xffffffff, true);
        expect(readZipEntryDates(zip).size).toBe(0);
      });
    });
  });
});
