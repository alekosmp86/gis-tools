import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC_DIR = fileURLToPath(new URL("../../../../../src", import.meta.url));
const MODULE_DIR = join(SRC_DIR, "modules", "coverage-loads");

const HoistedHelper = {
  COMPACT_DATE: "compactDate",
  CONTENT_DISPOSITION: "contentDisposition",
  LATIN1: "latin1",
} as const;

const HOISTED_HELPERS = Object.values(HoistedHelper);
const DUPLICATING_PARTS = ["indicators", "avance-ftth"] as const;
const PART_FOLDERS = ["indicators", "shp", "avance-ftth"] as const;

const IMPORT_PATTERN = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;

interface SourceFile {
  readonly name: string;
  readonly text: string;
}

function listFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

function readSources(directory: string): SourceFile[] {
  return listFiles(directory)
    .filter((path) => /\.(ts|tsx)$/.test(path))
    .map((path) => ({ name: relative(directory, path).replace(/\\/g, "/"), text: readFileSync(path, "utf8") }));
}

const importsOf = (source: SourceFile): string[] => [...source.text.matchAll(IMPORT_PATTERN)].map((match) => match[1]);
const sharedPathOf = (helper: string) => join(MODULE_DIR, "shared", "domain", `${helper}.ts`);
const importsHelperFromShared = (source: SourceFile, helper: string) =>
  importsOf(source).some((specifier) => new RegExp(`(^|/)shared/domain/${helper}$`).test(specifier));

describe("hoisted pure helpers (compactDate, contentDisposition, latin1)", () => {
  it.each(HOISTED_HELPERS)("should live once in shared/domain: %s", (helper) => {
    // Arrange & Act & Assert
    expect(existsSync(sharedPathOf(helper))).toBe(true);
  });

  describe.each(DUPLICATING_PARTS)("%s", (part) => {
    const sources = readSources(join(MODULE_DIR, part));

    it.each(HOISTED_HELPERS)("should hold no copy of %s of its own", (helper) => {
      // Arrange
      const copies = sources.filter((source) => source.name.endsWith(`/${helper}.ts`) || source.name === `${helper}.ts`);

      // Act & Assert
      expect(copies.map((source) => source.name)).toEqual([]);
    });

    it.each(HOISTED_HELPERS)("should import %s from shared/domain", (helper) => {
      // Arrange
      const importers = sources.filter((source) => importsHelperFromShared(source, helper));

      // Act & Assert
      expect(importers.length).toBeGreaterThan(0);
    });

    it.each(HOISTED_HELPERS)("should never import a local ./%s or domain/%s", (helper) => {
      // Arrange
      const offenders = sources
        .filter((source) =>
          importsOf(source).some((specifier) => !/shared\//.test(specifier) && new RegExp(`(^|/)${helper}$`).test(specifier))
        )
        .map((source) => source.name);

      // Act & Assert
      expect(offenders).toEqual([]);
    });
  });

  describe("shared helpers stay pure and independent", () => {
    it.each(HOISTED_HELPERS)("should not import a part, pg, next or react from shared/domain/%s", (helper) => {
      // Arrange
      const text = existsSync(sharedPathOf(helper)) ? readFileSync(sharedPathOf(helper), "utf8") : null;

      // Act
      const specifiers = text === null ? null : importsOf({ name: helper, text });

      // Assert
      expect(specifiers).not.toBeNull();
      const offenders = (specifiers ?? []).filter(
        (specifier) => /(^|\/)(indicators|shp|avance-ftth)(\/|$)/.test(specifier) || /^(pg|next|react)(\/|$)/.test(specifier)
      );
      expect(offenders).toEqual([]);
    });

    it("should keep indicators/ and avance-ftth/ from importing each other", () => {
      // Arrange
      const pairs = [
        ["indicators", "avance-ftth"],
        ["avance-ftth", "indicators"],
      ] as const;

      // Act
      const offenders = pairs.flatMap(([from, to]) =>
        readSources(join(MODULE_DIR, from))
          .filter((source) => importsOf(source).some((specifier) => new RegExp(`(^|/)${to}(/|$)`).test(specifier)))
          .map((source) => `${from}/${source.name} -> ${to}`)
      );

      // Assert
      expect(offenders).toEqual([]);
    });

    it("should keep shared/ from importing any part", () => {
      // Arrange
      const offenders = readSources(join(MODULE_DIR, "shared"))
        .filter((source) =>
          importsOf(source).some((specifier) => PART_FOLDERS.some((part) => new RegExp(`(^|/)${part}(/|$)`).test(specifier)))
        )
        .map((source) => source.name);

      // Act & Assert
      expect(offenders).toEqual([]);
    });
  });

  describe("generic upload readers (shared/uploadReaders.ts)", () => {
    const READERS = ["checkDeclaredBodySize", "readForm", "readFlag"] as const;
    const uploadReaderSources = DUPLICATING_PARTS.map((part) => ({
      part,
      file: readSources(join(MODULE_DIR, part)).find((source) => source.name === "api/uploadReaders.ts"),
    }));

    it("should exist in shared/", () => {
      // Arrange & Act & Assert
      expect(existsSync(join(MODULE_DIR, "shared", "uploadReaders.ts"))).toBe(true);
    });

    const definesReader = (text: string, reader: string) => new RegExp(String.raw`function\s+${reader}\b`).test(text);

    it("should have a reader-definition matcher that can fail (self-check)", () => {
      // Arrange & Act & Assert
      expect(definesReader("export async function readForm(request: Request) {}", "readForm")).toBe(true);
      expect(definesReader("function  readFlag(x) {}", "readFlag")).toBe(true);
      expect(definesReader("import { readForm } from './x';", "readForm")).toBe(false);
      expect(definesReader("function readFormData() {}", "readForm")).toBe(false);
    });

    it.each(DUPLICATING_PARTS)("should not redefine the generic readers in %s/api/uploadReaders.ts", (part) => {
      // Arrange
      const source = uploadReaderSources.find((entry) => entry.part === part)?.file;
      const definitions = READERS.filter((reader) => definesReader(source?.text ?? "", reader));

      // Act & Assert
      expect(definitions).toEqual([]);
    });

    it.each(DUPLICATING_PARTS)("should have the %s handlers import the generic readers from shared/uploadReaders", (part) => {
      // Arrange
      const handlers = readSources(join(MODULE_DIR, part)).find((source) => source.name === "api/handlers.ts");
      const text = handlers?.text ?? "";

      // Act
      const fromShared = importsOf({ name: "handlers", text }).some((specifier) => /(^|\/)shared\/uploadReaders$/.test(specifier));

      // Assert
      expect(fromShared).toBe(true);
      for (const reader of READERS) expect(text).toContain(reader);
    });
  });

  describe("generic constants (coverage-loads/constants.ts)", () => {
    const SHARED_CONSTANTS = [
      "MAX_FILE_BYTES",
      "MULTIPART_OVERHEAD_BYTES",
      "CSV_SEPARATOR",
      "CSV_ENCLOSURE",
      "REJECTED_FILE_PREFIX",
      "REJECTED_CSV_HEADER",
    ] as const;

    it("should export the generic values once, from the module-level constants file", async () => {
      // Arrange & Act
      const constants = (await import("@/modules/coverage-loads/constants")) as Record<string, unknown>;

      // Assert
      expect(constants.MAX_FILE_BYTES).toBe(10 * 1024 * 1024);
      expect(constants.MULTIPART_OVERHEAD_BYTES).toBe(1024 * 1024);
      expect(constants.CSV_SEPARATOR).toBe(";");
      expect(constants.CSV_ENCLOSURE).toBe('"');
      expect(constants.REJECTED_FILE_PREFIX).toBe("filas_rechazadas");
      expect(constants.REJECTED_CSV_HEADER).toEqual(["archivo", "linea", "texto", "motivo"]);
    });

    const declares = (text: string, name: string) => new RegExp(String.raw`export const ${name}\b`).test(text);

    it("should have a constant-declaration matcher that can fail (self-check)", () => {
      // Arrange & Act & Assert
      expect(declares('export const MAX_FILE_BYTES = 1;', "MAX_FILE_BYTES")).toBe(true);
      expect(declares('export { MAX_FILE_BYTES } from "../constants";', "MAX_FILE_BYTES")).toBe(false);
      expect(declares("export const MAX_FILE_BYTES_X = 1;", "MAX_FILE_BYTES")).toBe(false);
    });

    it.each(DUPLICATING_PARTS)("should not redeclare them in %s/constants.ts (re-exporting is fine)", (part) => {
      // Arrange
      const source = readFileSync(join(MODULE_DIR, part, "constants.ts"), "utf8");

      // Act
      const redeclared = SHARED_CONSTANTS.filter((name) => declares(source, name));

      // Assert
      expect(redeclared).toEqual([]);
    });
  });
});
