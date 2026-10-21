import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HistoryPrivilege } from "@/modules/coverage-loads/indicators/constants";
import {
  DELETE_STAGING_SQL,
  LOCK_STAGING_SQL,
} from "@/modules/coverage-loads/indicators/services/queries/historyQueries";
import * as historyQueries from "@/modules/coverage-loads/indicators/services/queries/historyQueries";

const MODULE_DIR = fileURLToPath(new URL("../../../../src/modules/coverage-loads", import.meta.url));

function listFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

const stripComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const sourcesIn = (part: string, folder: string) =>
  listFiles(join(MODULE_DIR, part, folder))
    .filter((path) => /\.ts$/.test(path))
    .map((path) => ({ name: relative(MODULE_DIR, path).split(sep).join("/"), text: stripComments(readFileSync(path, "utf8")) }));

describe("indicators SQL without TRUNCATE (the load role has no TRUNCATE privilege)", () => {
  it("should export the exact DELETE and SHARE ROW EXCLUSIVE statements", () => {
    // Arrange & Act & Assert
    expect(DELETE_STAGING_SQL).toBe("DELETE FROM public.indicadores_lte");
    expect(LOCK_STAGING_SQL).toBe("LOCK TABLE public.indicadores_lte IN SHARE ROW EXCLUSIVE MODE");
    expect("TRUNCATE_STAGING_SQL" in historyQueries).toBe(false);
  });

  it("should not offer a TRUNCATE privilege constant", () => {
    // Arrange & Act & Assert
    expect(Object.keys(HistoryPrivilege).sort()).toEqual(["DELETE", "INSERT", "SELECT"]);
  });

  it("should not contain the token TRUNCATE nor ACCESS EXCLUSIVE in the indicators services or constants", () => {
    // Arrange
    const files = [...sourcesIn("indicators", "services"), ...sourcesIn("indicators", ".").filter((file) => file.name.endsWith("/constants.ts"))];

    // Act
    const offenders = files.filter((file) => /\bTRUNCATE\b|ACCESS\s+EXCLUSIVE/i.test(file.text)).map((file) => file.name);

    // Assert
    expect(files.length).toBeGreaterThan(2);
    expect(offenders).toEqual([]);
  });
});

describe("shp SQL without TRUNCATE", () => {
  it("should not contain the token TRUNCATE in the shp job, its constants or the plan queries", () => {
    // Arrange
    const files = [...sourcesIn("shp", "job"), ...sourcesIn("shp", "services")];

    // Act
    const offenders = files.filter((file) => /\bTRUNCATE\b/i.test(file.text)).map((file) => file.name);

    // Assert
    expect(files.length).toBeGreaterThan(5);
    expect(offenders).toEqual([]);
  });
});
