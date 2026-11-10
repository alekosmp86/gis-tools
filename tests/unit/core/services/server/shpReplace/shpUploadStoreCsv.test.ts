import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm, utimes, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  CSV_UPLOAD_PROFILE,
  UploadInvalidError,
  UploadNotFoundError,
  UploadTooLargeError,
  deleteUpload,
  locateUpload,
  saveUpload,
  sweepUploads,
} from "@/core/services/server/shpReplace/shpUploadStore";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OLD_ID = "00000000-0000-4000-8000-000000000001";
const FRESH_ID = "00000000-0000-4000-8000-000000000003";
const HOUR_MS = 60 * 60 * 1000;
const NOW_MS = Date.UTC(2026, 0, 1, 12, 0, 0);

const streamOf = (...chunks: Uint8Array[]): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

async function listFiles(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

describe("shpUploadStore CSV profile", () => {
  let root: string;
  let dir: string;
  let options: { profile: typeof CSV_UPLOAD_PROFILE; dir: string };

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "csv-upload-store-"));
    dir = path.join(root, "uploads");
    options = { profile: CSV_UPLOAD_PROFILE, dir };
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  describe("CR-2: CSV_UPLOAD_PROFILE", () => {
    it("should store files with the .csv extension in a directory separate from the zip one", () => {
      expect(CSV_UPLOAD_PROFILE.extension).toBe(".csv");
      expect(CSV_UPLOAD_PROFILE.dir).toContain("gis-tools-csv-replace");
      expect(CSV_UPLOAD_PROFILE.dir).not.toContain("gis-tools-shp-replace");
    });

    it.each(["datos.csv", "DATOS.CSV", "datos.txt", "Datos.TXT", "mi archivo.csv"])(
      "should accept the file name %s",
      (fileName) => {
        expect(CSV_UPLOAD_PROFILE.namePattern.test(fileName)).toBe(true);
      }
    );

    it.each(["datos.zip", "datos.csv.exe", "datos", "", "datos.xlsx", "csv"])(
      "should reject the file name %j",
      (fileName) => {
        expect(CSV_UPLOAD_PROFILE.namePattern.test(fileName)).toBe(false);
      }
    );
  });

  describe("CR-2: saveUpload", () => {
    it("should store the bytes as <uuid>.csv and return the id and size", async () => {
      const result = await saveUpload(streamOf(bytes("id,n\n"), bytes("1,a\n")), "datos.csv", options);

      expect(result.uploadId).toMatch(UUID_PATTERN);
      expect(result.size).toBe(9);
      expect(await listFiles(dir)).toEqual([`${result.uploadId}.csv`]);
      expect(await readFile(path.join(dir, `${result.uploadId}.csv`), "utf8")).toBe("id,n\n1,a\n");
    });

    it("should store a .txt upload with the .csv extension", async () => {
      const result = await saveUpload(streamOf(bytes("a")), "datos.txt", options);

      expect(await listFiles(dir)).toEqual([`${result.uploadId}.csv`]);
    });

    it("should refuse a zip with the Spanish CSV name error and write nothing", async () => {
      await expect(saveUpload(streamOf(bytes("x")), "datos.zip", options)).rejects.toThrowError(
        new UploadInvalidError("Solo se admiten archivos .csv o .txt.")
      );
      expect(await listFiles(dir)).toEqual([]);
    });

    it("should refuse a missing file name", async () => {
      await expect(saveUpload(streamOf(bytes("x")), "", options)).rejects.toBeInstanceOf(UploadInvalidError);
    });

    it("should refuse a null body", async () => {
      await expect(saveUpload(null, "datos.csv", options)).rejects.toBeInstanceOf(UploadInvalidError);
    });

    it("should throw UploadTooLargeError with the 1 GiB Spanish message and remove the partial file when the limit is exceeded", async () => {
      const promise = saveUpload(streamOf(bytes("abcd"), bytes("efgh")), "datos.csv", { ...options, maxBytes: 5 });

      await expect(promise).rejects.toBeInstanceOf(UploadTooLargeError);
      await expect(promise).rejects.toThrowError("El archivo supera el límite de 1 GiB.");
      expect(await listFiles(dir)).toEqual([]);
    });

    it("should accept a body exactly at the byte limit", async () => {
      const result = await saveUpload(streamOf(bytes("abcde")), "datos.csv", { ...options, maxBytes: 5 });

      expect(result.size).toBe(5);
    });
  });

  describe("CR-2: locateUpload", () => {
    it("should return the path of the stored file when it exists", async () => {
      const { uploadId } = await saveUpload(streamOf(bytes("a")), "datos.csv", options);

      const located = await locateUpload(uploadId, options);

      expect(located).toBe(path.join(dir, `${uploadId}.csv`));
    });

    it("should throw UploadNotFoundError when the id is a valid UUID but no file exists", async () => {
      await mkdir(dir, { recursive: true });

      await expect(locateUpload(FRESH_ID, options)).rejects.toBeInstanceOf(UploadNotFoundError);
    });

    it("should throw UploadNotFoundError when the directory does not exist", async () => {
      await expect(locateUpload(FRESH_ID, options)).rejects.toBeInstanceOf(UploadNotFoundError);
    });

    it.each(["../etc/passwd", "..\\x", "not-a-uuid", "", "123e4567-e89b-42d3-a456-426614174000/../x"])(
      "should throw UploadNotFoundError without touching the disk when the id is %j",
      async (uploadId) => {
        await expect(locateUpload(uploadId, options)).rejects.toBeInstanceOf(UploadNotFoundError);
      }
    );

    it("should not find a .zip upload of the same id with the CSV profile", async () => {
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, `${FRESH_ID}.zip`), "x");

      await expect(locateUpload(FRESH_ID, options)).rejects.toBeInstanceOf(UploadNotFoundError);
    });

    it("should carry a Spanish message in the not found error", async () => {
      await expect(locateUpload(FRESH_ID, options)).rejects.toThrowError("No existe la subida solicitada.");
    });
  });

  describe("CR-2: deleteUpload and sweepUploads", () => {
    it("should delete the stored csv and tolerate deleting it twice", async () => {
      const { uploadId } = await saveUpload(streamOf(bytes("a")), "datos.csv", options);

      await deleteUpload(uploadId, options);
      await deleteUpload(uploadId, options);

      expect(await listFiles(dir)).toEqual([]);
    });

    it("should sweep only stale .csv uploads and leave fresh ones and foreign files", async () => {
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, `${OLD_ID}.csv`), "x");
      await writeFile(path.join(dir, `${FRESH_ID}.csv`), "x");
      await writeFile(path.join(dir, `${OLD_ID}.zip`), "x");
      await writeFile(path.join(dir, "notes.csv"), "x");
      const oldSeconds = (NOW_MS - 3 * HOUR_MS) / 1000;
      await utimes(path.join(dir, `${OLD_ID}.csv`), oldSeconds, oldSeconds);
      await utimes(path.join(dir, `${OLD_ID}.zip`), oldSeconds, oldSeconds);
      const freshSeconds = NOW_MS / 1000;
      await utimes(path.join(dir, `${FRESH_ID}.csv`), freshSeconds, freshSeconds);

      const removed = await sweepUploads(2 * HOUR_MS, { ...options, now: () => NOW_MS });

      expect(removed).toBe(1);
      expect(await listFiles(dir)).toEqual([`${FRESH_ID}.csv`, `${OLD_ID}.zip`, "notes.csv"].sort());
    });

    it("should return 0 when the directory does not exist", async () => {
      expect(await sweepUploads(HOUR_MS, options)).toBe(0);
    });
  });
});
