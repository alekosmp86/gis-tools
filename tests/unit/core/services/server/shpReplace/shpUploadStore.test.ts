import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  MAX_UPLOAD_BYTES,
  UploadInvalidError,
  UploadNotFoundError,
  UploadTooLargeError,
  deleteUpload,
  readUpload,
  saveUpload,
  sweepUploads,
} from "@/core/services/server/shpReplace/shpUploadStore";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIXED_ID = "123e4567-e89b-42d3-a456-426614174000";
const OLD_ID = "00000000-0000-4000-8000-000000000001";
const EDGE_ID = "00000000-0000-4000-8000-000000000002";
const FRESH_ID = "00000000-0000-4000-8000-000000000003";
const HOUR_MS = 60 * 60 * 1000;
const NOW_MS = Date.UTC(2026, 0, 1, 12, 0, 0);

function streamOf(...chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

function streamFailingAfter(chunk: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(chunk);
    },
    pull(controller) {
      controller.error(new Error("conexión cortada por el cliente"));
    },
  });
}

async function listFiles(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

describe("shpUploadStore", () => {
  let root: string;
  let dir: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "shp-upload-store-"));
    dir = path.join(root, "uploads");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  describe("MAX_UPLOAD_BYTES", () => {
    it("should equal one GiB when the constant is read", () => {
      expect(MAX_UPLOAD_BYTES).toBe(1024 ** 3);
    });
  });

  describe("saveUpload", () => {
    it("should stream the chunks into <dir>/<uuid>.zip and return the uploadId and total size when the body is a zip", async () => {
      const result = await saveUpload(streamOf(Uint8Array.of(1, 2), Uint8Array.of(3)), "parcelas.zip", { dir });

      expect(result.uploadId).toMatch(UUID_PATTERN);
      expect(result.size).toBe(3);
      expect(await listFiles(dir)).toEqual([`${result.uploadId}.zip`]);
      expect(Array.from(await readFile(path.join(dir, `${result.uploadId}.zip`)))).toEqual([1, 2, 3]);
    });

    it("should return a different uploadId for each saved upload when two uploads are saved", async () => {
      const first = await saveUpload(streamOf(Uint8Array.of(1)), "a.zip", { dir });
      const second = await saveUpload(streamOf(Uint8Array.of(2)), "b.zip", { dir });

      expect(first.uploadId).not.toBe(second.uploadId);
    });

    it("should store the file inside dir when the file name contains path segments", async () => {
      const result = await saveUpload(streamOf(Uint8Array.of(7)), "../../evil.zip", { dir });

      expect(await listFiles(dir)).toEqual([`${result.uploadId}.zip`]);
      expect(await listFiles(root)).toEqual(["uploads"]);
    });

    it("should accept a body whose size equals maxBytes exactly when the limit is inclusive", async () => {
      const result = await saveUpload(streamOf(Uint8Array.of(1, 2), Uint8Array.of(3, 4)), "a.zip", { dir, maxBytes: 4 });

      expect(result.size).toBe(4);
    });

    it("should reject with UploadTooLargeError and leave no file when the body exceeds maxBytes by one byte", async () => {
      await expect(
        saveUpload(streamOf(Uint8Array.of(1, 2), Uint8Array.of(3, 4, 5)), "a.zip", { dir, maxBytes: 4 })
      ).rejects.toBeInstanceOf(UploadTooLargeError);

      expect(await listFiles(dir)).toEqual([]);
    });

    it("should reject with UploadTooLargeError and leave no file when a single chunk exceeds maxBytes", async () => {
      await expect(
        saveUpload(streamOf(Uint8Array.of(1, 2, 3, 4, 5, 6)), "a.zip", { dir, maxBytes: 4 })
      ).rejects.toBeInstanceOf(UploadTooLargeError);

      expect(await listFiles(dir)).toEqual([]);
    });

    it("should reject with UploadInvalidError and leave no file when the body is null", async () => {
      await expect(saveUpload(null, "a.zip", { dir })).rejects.toBeInstanceOf(UploadInvalidError);

      expect(await listFiles(dir)).toEqual([]);
    });

    it.each(["parcelas.shp", "parcelas", "", "parcelas.zip.exe", "parcelas.zipx"])(
      "should reject with UploadInvalidError and leave no file when the file name is %j",
      async (fileName) => {
        await expect(saveUpload(streamOf(Uint8Array.of(1)), fileName, { dir })).rejects.toBeInstanceOf(
          UploadInvalidError
        );

        expect(await listFiles(dir)).toEqual([]);
      }
    );

    it("should reject and leave no partial file when the body stream errors midway", async () => {
      await expect(saveUpload(streamFailingAfter(Uint8Array.of(1, 2)), "a.zip", { dir })).rejects.toThrow(
        "conexión cortada por el cliente"
      );

      expect(await listFiles(dir)).toEqual([]);
    });
  });

  describe("readUpload", () => {
    it("should return the saved bytes when the uploadId exists", async () => {
      const saved = await saveUpload(streamOf(Uint8Array.of(9, 8), Uint8Array.of(7)), "a.zip", { dir });

      const bytes = await readUpload(saved.uploadId, { dir });

      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(Array.from(bytes)).toEqual([9, 8, 7]);
    });

    it("should return the bytes of a file written under a fixed uuid name when the uploadId matches it", async () => {
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, `${FIXED_ID}.zip`), Uint8Array.of(5, 6));

      const bytes = await readUpload(FIXED_ID, { dir });

      expect(Array.from(bytes)).toEqual([5, 6]);
    });

    it("should reject with UploadNotFoundError when the uuid is valid but no file exists", async () => {
      await mkdir(dir, { recursive: true });

      await expect(readUpload(FIXED_ID, { dir })).rejects.toBeInstanceOf(UploadNotFoundError);
    });

    it("should reject with UploadNotFoundError when the upload directory does not exist", async () => {
      await expect(readUpload(FIXED_ID, { dir })).rejects.toBeInstanceOf(UploadNotFoundError);
    });

    it.each(["../x", "a/b", "", "   ", "parcelas.zip", "not-a-uuid", `${FIXED_ID}/../x`])(
      "should reject with UploadNotFoundError when the uploadId is %j",
      async (uploadId) => {
        await expect(readUpload(uploadId, { dir })).rejects.toBeInstanceOf(UploadNotFoundError);
      }
    );

    it("should reject with UploadNotFoundError and never read a file outside dir when the uploadId is a traversal", async () => {
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(root, "x.zip"), "secreto");

      await expect(readUpload("../x", { dir })).rejects.toBeInstanceOf(UploadNotFoundError);
    });
  });

  describe("deleteUpload", () => {
    it("should remove the file when the uploadId exists", async () => {
      const saved = await saveUpload(streamOf(Uint8Array.of(1)), "a.zip", { dir });

      await deleteUpload(saved.uploadId, { dir });

      expect(await listFiles(dir)).toEqual([]);
    });

    it("should resolve without error when the uuid has no file", async () => {
      await mkdir(dir, { recursive: true });

      await expect(deleteUpload(FIXED_ID, { dir })).resolves.toBeUndefined();
    });

    it("should resolve without error when the same upload is deleted twice", async () => {
      const saved = await saveUpload(streamOf(Uint8Array.of(1)), "a.zip", { dir });

      await deleteUpload(saved.uploadId, { dir });

      await expect(deleteUpload(saved.uploadId, { dir })).resolves.toBeUndefined();
    });

    it("should reject with UploadNotFoundError and keep the sibling file when the uploadId is a traversal", async () => {
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(root, "x.zip"), "secreto");

      await expect(deleteUpload("../x", { dir })).rejects.toBeInstanceOf(UploadNotFoundError);

      expect(await listFiles(root)).toEqual(["uploads", "x.zip"]);
    });
  });

  describe("sweepUploads", () => {
    async function writeWithAge(id: string, ageMs: number): Promise<void> {
      const file = path.join(dir, `${id}.zip`);
      await writeFile(file, Uint8Array.of(1));
      const mtime = new Date(NOW_MS - ageMs);
      await utimes(file, mtime, mtime);
    }

    it("should remove only the uploads older than maxAgeMs and return their count", async () => {
      await mkdir(dir, { recursive: true });
      await writeWithAge(OLD_ID, 3 * HOUR_MS);
      await writeWithAge(EDGE_ID, 2 * HOUR_MS);
      await writeWithAge(FRESH_ID, 10 * 60 * 1000);

      const removed = await sweepUploads(2 * HOUR_MS, { dir, now: () => NOW_MS });

      expect(removed).toBe(1);
      expect(await listFiles(dir)).toEqual([`${EDGE_ID}.zip`, `${FRESH_ID}.zip`].sort());
    });

    it("should keep an upload whose age equals maxAgeMs exactly when the age is not strictly greater", async () => {
      await mkdir(dir, { recursive: true });
      await writeWithAge(EDGE_ID, 2 * HOUR_MS);

      const removed = await sweepUploads(2 * HOUR_MS, { dir, now: () => NOW_MS });

      expect(removed).toBe(0);
      expect(await listFiles(dir)).toEqual([`${EDGE_ID}.zip`]);
    });

    it("should return zero and remove nothing when every upload is recent", async () => {
      await mkdir(dir, { recursive: true });
      await writeWithAge(FRESH_ID, 60 * 1000);

      const removed = await sweepUploads(2 * HOUR_MS, { dir, now: () => NOW_MS });

      expect(removed).toBe(0);
      expect(await listFiles(dir)).toEqual([`${FRESH_ID}.zip`]);
    });

    it("should return zero without error when the upload directory does not exist", async () => {
      const removed = await sweepUploads(2 * HOUR_MS, { dir, now: () => NOW_MS });

      expect(removed).toBe(0);
    });
  });
});
