import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC_DIR = fileURLToPath(new URL("../../../../../src", import.meta.url));
const MODULE_DIR = join(SRC_DIR, "modules", "coverage-loads");
const AVANCE_DIR = join(MODULE_DIR, "avance-ftth");

function listFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

interface SourceFile {
  readonly name: string;
  readonly path: string;
  readonly text: string;
}

function readSources(directory: string, extensions: RegExp): SourceFile[] {
  return listFiles(directory)
    .filter((path) => extensions.test(path))
    .map((path) => ({
      name: relative(directory, path).replace(/\\/g, "/"),
      path,
      text: readFileSync(path, "utf8"),
    }));
}

const IMPORT_PATTERN = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;
const importSpecifiers = (text: string): string[] => [...text.matchAll(IMPORT_PATTERN)].map((match) => match[1]);

const avanceSources = readSources(AVANCE_DIR, /\.(ts|tsx)$/);
const avanceAllFiles = readSources(AVANCE_DIR, /\.(ts|tsx|css|json)$/);
const namesPart = (part: string) => (source: SourceFile) => source.name.startsWith(`${part}/`);

const TABLE_LITERALS = [
  "avance_planilla",
  "avance_uruguay_planilla",
  "h_avance_uruguay",
  "area_zonas_ftth_f",
  "limite_central_ftth",
];

const DATA_STATEMENTS = [
  /\bSELECT\s+[\w*(]/,
  /\bINSERT\s+INTO\b/,
  /\bDELETE\s+FROM\b/,
  /\bTRUNCATE\s+(TABLE\s+)?[\w$]/,
  /\bUPDATE\s+[\w$.]+\s+SET\b/,
  /\bLOCK\s+TABLE\b/,
];

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("avance-ftth boundaries (AC-30, AC-31)", () => {
  it("should scan a meaningful set of files", () => {
    // Arrange & Act & Assert
    expect(avanceSources.length).toBeGreaterThan(30);
    expect(avanceSources.filter(namesPart("domain")).length).toBeGreaterThan(8);
    expect(avanceSources.filter(namesPart("services")).length).toBeGreaterThan(4);
    expect(avanceSources.filter(namesPart("api")).length).toBeGreaterThan(0);
    expect(avanceSources.filter(namesPart("ui")).length).toBeGreaterThan(10);
  });

  describe("independence from the sibling parts (AC-28, AC-31)", () => {
    it("should never import indicators/ or shp/ from anywhere in avance-ftth", () => {
      // Arrange
      const offenders = avanceSources
        .flatMap((source) => importSpecifiers(source.text).map((specifier) => ({ source, specifier })))
        .filter(({ specifier }) => /(^|\/)(indicators|shp)(\/|$)/.test(specifier))
        .map(({ source, specifier }) => `${source.name} -> ${specifier}`);

      // Assert
      expect(offenders).toEqual([]);
    });

    it("should not be imported by indicators/, shp/ or shared/", () => {
      // Arrange
      const others = ["indicators", "shp", "shared"].flatMap((part) =>
        readSources(join(MODULE_DIR, part), /\.(ts|tsx)$/).map((source) => ({ ...source, name: `${part}/${source.name}` }))
      );

      // Act
      const offenders = others
        .filter((source) => importSpecifiers(source.text).some((specifier) => /(^|\/)avance-ftth(\/|$)/.test(specifier)))
        .map((source) => source.name);

      // Assert
      expect(others.length).toBeGreaterThan(20);
      expect(offenders).toEqual([]);
    });

    it("should not name another module's folder in any import", () => {
      // Arrange
      const offenders = avanceSources
        .filter((source) => /from\s+["']@\/modules\/(?!coverage-loads\b)/.test(source.text))
        .map((source) => source.name);

      // Assert
      expect(offenders).toEqual([]);
    });
  });

  describe("deletable with the module (AC-31)", () => {
    it("should be referenced from outside its folder only by the wiring: handlers, manifest, routes, stage registry and generated routes", () => {
      // Arrange
      const outside = ["app", "core", "ui-kit", "modules"].flatMap((folder) => listFiles(join(SRC_DIR, folder)));

      // Act
      const referencing = outside
        .filter((path) => !path.startsWith(AVANCE_DIR))
        .filter((path) => /\.(ts|tsx|json)$/.test(path))
        .filter((path) => /avance-ftth/.test(readFileSync(path, "utf8")))
        .map((path) => relative(SRC_DIR, path).replace(/\\/g, "/"))
        .sort();

      // Assert
      expect(referencing).toEqual([
        "app/api/m/coverage-loads/avance-ftth/load/route.ts",
        "app/api/m/coverage-loads/avance-ftth/plan/route.ts",
        "app/api/m/coverage-loads/avance-ftth/reports/route.ts",
        "modules/coverage-loads/api/handlers.ts",
        "modules/coverage-loads/manifest.ts",
        "modules/coverage-loads/module.routes.json",
        "modules/coverage-loads/workflow/domain/coverageStageId.ts",
        "modules/coverage-loads/workflow/ui/coverageStages.ts",
      ]);
    });

    it("should use the layout constants.ts, types.ts, domain/, services/, api/ and ui/ (plus the client.ts browser entry)", () => {
      // Arrange
      const top = new Set(avanceAllFiles.map((source) => source.name.split("/")[0]));

      // Act & Assert
      expect([...top].sort()).toEqual(["api", "client.ts", "constants.ts", "domain", "services", "types.ts", "ui"]);
    });
  });

  describe("domain is pure (AC-30)", () => {
    const domain = avanceSources.filter(namesPart("domain"));

    it("should not import pg, next or react (nor their sub-paths)", () => {
      // Arrange
      const forbidden = /^(pg|pg-[\w-]+|next|react|react-dom)(\/|$)/;

      // Act
      const offenders = domain
        .flatMap((source) => importSpecifiers(source.text).map((specifier) => ({ source, specifier })))
        .filter(({ specifier }) => forbidden.test(specifier))
        .map(({ source, specifier }) => `${source.name} -> ${specifier}`);

      // Assert
      expect(offenders).toEqual([]);
    });

    it("should not import the database plumbing, the services, the api or the ui", () => {
      // Arrange
      const offenders = domain
        .flatMap((source) => importSpecifiers(source.text).map((specifier) => ({ source, specifier })))
        .filter(({ specifier }) => /(^|\/)(services|api|ui|pgClient|runInTransaction)(\/|$|\.)/.test(specifier))
        .map(({ source, specifier }) => `${source.name} -> ${specifier}`);

      // Assert
      expect(offenders).toEqual([]);
    });
  });

  describe("tables and SQL (AC-30)", () => {
    it.each(TABLE_LITERALS)("should name the table literal %s only in constants.ts", (literal) => {
      // Arrange
      const offenders = avanceAllFiles
        .filter((source) => source.name !== "constants.ts")
        .filter((source) => source.text.includes(literal))
        .map((source) => source.name);

      // Assert
      expect(offenders).toEqual([]);
      expect(avanceAllFiles.find((source) => source.name === "constants.ts")?.text).toContain(literal);
    });

    it("should write no data statement outside services/queries/", () => {
      // Arrange
      const offenders = avanceSources
        .filter((source) => !source.name.startsWith("services/queries/"))
        .filter((source) => DATA_STATEMENTS.some((pattern) => pattern.test(stripComments(source.text))))
        .map((source) => source.name);

      // Assert
      expect(offenders).toEqual([]);
    });

    it("should keep the SQL in services/queries/ as named exported constants (the files do hold statements)", () => {
      // Arrange
      const queries = avanceSources.filter((source) => source.name.startsWith("services/queries/"));

      // Act
      const holders = queries.filter((source) => DATA_STATEMENTS.some((pattern) => pattern.test(stripComments(source.text))));

      // Assert
      expect(holders.map((source) => source.name).sort()).toEqual([
        "services/queries/rebuildQueries.ts",
        "services/queries/reportQueries.ts",
        "services/queries/stateQueries.ts",
      ]);
      for (const source of holders) expect(source.text).toMatch(/export const [A-Z_]+(_SQL|_QUERIES)/);
    });
  });

  describe("browser entry and ui (AC-28)", () => {
    function closure(entry: string): string[] {
      const seen = new Set<string>();
      const pending = [entry];
      while (pending.length > 0) {
        const path = pending.pop() as string;
        if (seen.has(path)) continue;
        seen.add(path);
        for (const specifier of importSpecifiers(readFileSync(path, "utf8"))) {
          if (!specifier.startsWith(".")) continue;
          const base = resolve(dirname(path), specifier);
          const candidate = [`${base}.ts`, join(base, "index.ts")].find((file) => {
            try {
              return statSync(file).isFile();
            } catch {
              return false;
            }
          });
          if (candidate) pending.push(candidate);
        }
      }
      return [...seen];
    }

    it("should keep everything client.ts reaches free of node, pg and next imports", () => {
      // Arrange
      const reached = closure(join(AVANCE_DIR, "client.ts"));

      // Act
      const offenders = reached
        .flatMap((path) => importSpecifiers(readFileSync(path, "utf8")).map((specifier) => `${relative(AVANCE_DIR, path)} -> ${specifier}`))
        .filter((edge) => /-> (node:|pg$|pg\/|next|fs$|path$|zlib$)/.test(edge));

      // Assert
      expect(reached.length).toBeGreaterThan(3);
      expect(offenders).toEqual([]);
    });

    it("should keep the ui from importing services/, api/ or pg", () => {
      // Arrange
      const offenders = avanceSources
        .filter(namesPart("ui"))
        .flatMap((source) => importSpecifiers(source.text).map((specifier) => ({ source, specifier })))
        .filter(({ specifier }) => /(^|\/)(services|api)(\/|$)|^pg(\/|$)|^node:/.test(specifier))
        .map(({ source, specifier }) => `${source.name} -> ${specifier}`);

      // Assert
      expect(offenders).toEqual([]);
    });

    it("should use no inline styles in the ui", () => {
      // Arrange
      const offenders = avanceSources.filter(namesPart("ui")).filter((source) => /style=\{/.test(source.text)).map((source) => source.name);

      // Assert
      expect(offenders).toEqual([]);
    });
  });
});
