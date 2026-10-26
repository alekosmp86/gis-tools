import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const MODULE_DIR = join(process.cwd(), "src", "modules", "routine-jobs");
const UI_DIR = join(MODULE_DIR, "ui");
const ALLOWED_ALIAS_PREFIXES = ["@/core/", "@/ui-kit/", "@/modules/routine-jobs/"];
const IMPORT_SPECIFIER = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry) ? [path] : [];
  });
}

const specifiersOf = (text: string): string[] => [...text.matchAll(IMPORT_SPECIFIER)].map((match) => match[1]);
const nameOf = (path: string): string => relative(UI_DIR, path).split(sep).join("/");

const uiFiles = sourceFiles(UI_DIR).map((path) => ({ name: nameOf(path), text: readFileSync(path, "utf8"), path }));

describe("routine-jobs UI boundaries", () => {
  it("AC-32: should contain the contract files of the UI round", () => {
    const names = uiFiles.map((file) => file.name);

    for (const expected of [
      "CargarPadronesWizard.tsx",
      "CargarPadronesReport.tsx",
      "RoutineJobsDashboard.tsx",
      "RoutineJobsHomeCard.tsx",
      "jobs.ts",
      "wizardSteps.ts",
      "steps/ConnectionStep.tsx",
      "steps/TablesStep.tsx",
      "steps/OptionsStep.tsx",
      "steps/ReviewStep.tsx",
      "steps/ResultStep.tsx",
    ]) {
      expect(names, expected).toContain(expected);
    }
  });

  it("AC-33: should import only core, ui-kit and its own folder through the alias", () => {
    const offenders = uiFiles.flatMap((file) =>
      specifiersOf(file.text)
        .filter((specifier) => specifier.startsWith("@/") && !ALLOWED_ALIAS_PREFIXES.some((prefix) => specifier.startsWith(prefix)))
        .map((specifier) => `${file.name} -> ${specifier}`),
    );

    expect(offenders).toEqual([]);
  });

  it("AC-33: should not reach into another module with a relative path", () => {
    const offenders = uiFiles.flatMap((file) =>
      specifiersOf(file.text)
        .filter((specifier) => specifier.startsWith("."))
        .filter((specifier) => {
          const resolved = join(file.path, "..", specifier);
          return !resolved.startsWith(MODULE_DIR);
        })
        .map((specifier) => `${file.name} -> ${specifier}`),
    );

    expect(offenders).toEqual([]);
  });

  it("AC-33: should keep server-only code out of the client files", () => {
    const offenders = uiFiles.flatMap((file) =>
      specifiersOf(file.text)
        .filter((specifier) => /services\/server|\/api\/|^pg$|^node:|^fs$/.test(specifier))
        .map((specifier) => `${file.name} -> ${specifier}`),
    );

    expect(offenders).toEqual([]);
  });

  it("AC-32: should use no inline style attribute in any component", () => {
    const offenders = uiFiles.filter((file) => file.name.endsWith(".tsx") && /style=\{/.test(file.text)).map((file) => file.name);

    expect(offenders).toEqual([]);
  });
});
