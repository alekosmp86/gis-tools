import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFirstLine, readUtf8Chunks } from "@/core/services/server/csvReplace/utf8FileChunks";

const CHUNK_BYTES = 64 * 1024;

describe("utf8FileChunks", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "csv-chunks-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const writeBytes = (name: string, bytes: Uint8Array | string): string => {
    const filePath = path.join(dir, name);
    writeFileSync(filePath, bytes);
    return filePath;
  };

  const readAll = (filePath: string): string => Array.from(readUtf8Chunks(filePath)).join("");

  describe("CR-4: readUtf8Chunks", () => {
    it("should return the whole text when the file is small and valid UTF-8", () => {
      const filePath = writeBytes("a.csv", "id,nombre\n1,Ñandú\n");

      expect(readAll(filePath)).toBe("id,nombre\n1,Ñandú\n");
    });

    it("should yield nothing meaningful when the file is empty", () => {
      const filePath = writeBytes("empty.csv", "");

      expect(readAll(filePath)).toBe("");
    });

    it("should strip a leading UTF-8 BOM", () => {
      const filePath = writeBytes("bom.csv", Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("id,x\n")]));

      expect(readAll(filePath)).toBe("id,x\n");
    });

    it("should decode a multi-byte character that straddles the internal chunk boundary", () => {
      const padding = "a".repeat(CHUNK_BYTES - 1);
      const filePath = writeBytes("straddle.csv", `${padding}é,fin\n`);

      expect(readAll(filePath)).toBe(`${padding}é,fin\n`);
    });

    it("should decode a four-byte character that straddles the internal chunk boundary", () => {
      const padding = "a".repeat(CHUNK_BYTES - 2);
      const filePath = writeBytes("emoji.csv", `${padding}😀z\n`);

      expect(readAll(filePath)).toBe(`${padding}😀z\n`);
    });

    it("should return several chunks when the file is larger than one chunk", () => {
      const filePath = writeBytes("big.csv", "x".repeat(CHUNK_BYTES * 2 + 10));

      const chunks = Array.from(readUtf8Chunks(filePath));

      expect(chunks.length).toBeGreaterThan(2);
      expect(chunks.join("")).toHaveLength(CHUNK_BYTES * 2 + 10);
    });

    it("should throw a Spanish UTF-8 error when the file holds a Latin-1 byte", () => {
      const filePath = writeBytes("latin1.csv", Buffer.from([0x69, 0x64, 0x2c, 0xe9, 0x0a]));

      expect(() => readAll(filePath)).toThrowError(/UTF-8/);
    });

    it("should throw the UTF-8 error when the invalid byte sits beyond the first chunk", () => {
      const bytes = Buffer.concat([Buffer.from("a".repeat(CHUNK_BYTES * 2)), Buffer.from([0xff]), Buffer.from("\n")]);
      const filePath = writeBytes("late.csv", bytes);

      expect(() => readAll(filePath)).toThrowError(/UTF-8/);
    });

    it("should throw the UTF-8 error when the file ends in the middle of a multi-byte character", () => {
      const filePath = writeBytes("truncated.csv", Buffer.from([0x61, 0xc3]));

      expect(() => readAll(filePath)).toThrowError(/UTF-8/);
    });

    it("should throw when the file does not exist", () => {
      expect(() => readAll(path.join(dir, "missing.csv"))).toThrowError();
    });
  });

  describe("CR-4: readFirstLine", () => {
    it.each([
      ["LF", "id,nombre\n1,a\n"],
      ["CRLF", "id,nombre\r\n1,a\r\n"],
      ["lone CR", "id,nombre\r1,a\r"],
    ])("should return only the header line when the file uses %s", (_label, text) => {
      const filePath = writeBytes("h.csv", text);

      expect(readFirstLine(filePath)).toBe("id,nombre");
    });

    it("should return the whole content when the file has a single line without break", () => {
      const filePath = writeBytes("single.csv", "a;b;c");

      expect(readFirstLine(filePath)).toBe("a;b;c");
    });

    it("should return an empty string when the file is empty", () => {
      const filePath = writeBytes("empty.csv", "");

      expect(readFirstLine(filePath)).toBe("");
    });

    it("should not include the BOM in the header line", () => {
      const filePath = writeBytes("bom.csv", Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("id;x\n")]));

      expect(readFirstLine(filePath)).toBe("id;x");
    });
  });
});
