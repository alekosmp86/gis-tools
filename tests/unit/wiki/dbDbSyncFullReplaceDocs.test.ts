import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPOSITORY_ROOT = path.resolve(__dirname, "../../..");
const readRepoFile = (relativePath: string): string =>
  readFileSync(path.join(REPOSITORY_ROOT, relativePath), "utf8");

const WIKI_PAGES = [
  "src/wiki/db-db-sync/reemplazo-completo.md",
  "src/wiki/db-db-sync/index.md",
  "src/wiki/db-db-sync/preguntas-frecuentes.md",
];

describe("db-db-sync Full Replace user documentation", () => {
  it.each(WIKI_PAGES)("should not mention TRUNCATE in %s", (relativePath) => {
    expect(readRepoFile(relativePath).toUpperCase()).not.toContain("TRUNCATE");
  });

  it("should describe the DELETE statement in the batch-1 steps of reemplazo-completo", () => {
    expect(readRepoFile("src/wiki/db-db-sync/reemplazo-completo.md")).toMatch(/sentencia `DELETE`/);
  });

  it("should list DELETE and INSERT as the Full Replace privileges in the index prerequisites", () => {
    expect(readRepoFile("src/wiki/db-db-sync/index.md")).toMatch(/`DELETE` e `INSERT` para el Reemplazo completo/);
  });

  it("should mention the sequence UPDATE privilege in the index prerequisites", () => {
    expect(readRepoFile("src/wiki/db-db-sync/index.md")).toMatch(/`UPDATE`[^\n]*secuencias/);
  });

  it("should list DELETE or INSERT as the missing permission in preguntas-frecuentes", () => {
    expect(readRepoFile("src/wiki/db-db-sync/preguntas-frecuentes.md")).toMatch(/permiso de `DELETE` o `INSERT`/);
  });

  it("should state in reemplazo-completo that sequences are always adjusted afterwards", () => {
    const page = readRepoFile("src/wiki/db-db-sync/reemplazo-completo.md").replace(/\s+/g, " ");
    expect(page).toMatch(/se ajusta/i);
    expect(page).toMatch(/id más alto/i);
  });

  it("should no longer claim the sequence keeps what the aborted inserts consumed in reemplazo-completo", () => {
    const page = readRepoFile("src/wiki/db-db-sync/reemplazo-completo.md").replace(/\s+/g, " ");
    expect(page).not.toMatch(/conserva lo que consumieron/i);
    expect(page).not.toMatch(/\*\*no se revierte\*\*/i);
  });

  it("should no longer say in preguntas-frecuentes that the sequence reset is not rolled back", () => {
    const page = readRepoFile("src/wiki/db-db-sync/preguntas-frecuentes.md");
    expect(page).not.toMatch(/el reinicio de secuencias no se revierte/i);
  });

  it("should document the repair outcome field and the raise-only repair in the tool doc and the replace spec", () => {
    const toolDoc = readRepoFile("docs/tools/DB_DB_SYNC_TOOL.md");
    const spec = readRepoFile("docs/specifications/DB_DB_REPLACE_TARGET_SPEC.md");
    expect(toolDoc).toContain("sequencesAdjusted");
    expect(spec).toContain("sequencesAdjusted");
    expect(spec).toContain("pg_sequence_last_value");
  });

  it("should not describe the Full Replace as a TRUNCATE in the tool doc and the replace spec", () => {
    const toolDoc = readRepoFile("docs/tools/DB_DB_SYNC_TOOL.md");
    const spec = readRepoFile("docs/specifications/DB_DB_REPLACE_TARGET_SPEC.md");
    expect(toolDoc.toUpperCase()).not.toContain("TRUNCATE");
    expect(spec.toUpperCase()).not.toContain("TRUNCATE");
  });
});
