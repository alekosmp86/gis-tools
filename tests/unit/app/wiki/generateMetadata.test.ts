import { describe, expect, it } from "vitest";
import { generateMetadata } from "@/app/wiki/[tool]/[page]/page";

const meta = (tool: string, page: string) => generateMetadata({ params: Promise.resolve({ tool, page }) });

describe("wiki page generateMetadata", () => {
  it("should title the page '<tool> | Wiki' when the page title equals the tool title", async () => {
    const result = await meta("db-db-sync", "index");

    expect(result.title).toBe("Sincronización de Datos DB vs. DB (Réplicas) | Wiki");
  });

  it("should title the page '<page> | <tool> | Wiki' when the titles differ", async () => {
    const result = await meta("db-db-sync", "comparar");

    expect(result.title).toBe("Modo Comparar | Sincronización de Datos DB vs. DB (Réplicas) | Wiki");
  });

  it("should fall back to 'Wiki' when the tool is unknown", async () => {
    expect((await meta("nope", "index")).title).toBe("Wiki");
  });

  it("should fall back to 'Wiki' when the page is unknown", async () => {
    expect((await meta("db-db-sync", "nope")).title).toBe("Wiki");
  });
});
