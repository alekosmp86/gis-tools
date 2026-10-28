import { beforeAll, describe, expect, it } from "vitest";
import { getWikiSources } from "@/app/wiki/wikiSources";
import { buildWikiIndex } from "@/core/wiki/buildWikiIndex";
import { nodeWikiFileSystem } from "@/core/wiki/nodeWikiFileSystem";
import type { WikiPage } from "@/core/wiki/types";

const TOOL = "routine-jobs";
const EXPECTED_PAGES = [
  "index",
  "cargar-padrones",
  "cargar-localidades",
  "unidad-territorial",
  "completar-unidad-territorial",
  "actualizar-padron",
  "descargar-informe",
  "solucion-de-problemas",
];
const TOPIC_PAGES = EXPECTED_PAGES.slice(1);
const INDEX_LINK = /\]\(([a-z0-9-]+)\.md\)/g;
const RELATIVE_MD_LINK = /\]\((?!https?:\/\/)([^)\s#]+\.md)(?:#[^)\s]*)?\)/g;
const STEP_NAMES = ["Conexión", "Tablas", "Opciones", "Revisar", "Resultado"];
const UI_LABELS = [
  "Reparar geometrías inválidas",
  "Vaciar tabla destino",
  "Reiniciar secuencias del destino",
  "Analizar sin cargar",
  "Cargar ahora",
];

describe("routine-jobs wiki content", () => {
  let pages: ReadonlyArray<WikiPage>;

  beforeAll(async () => {
    const index = await buildWikiIndex(getWikiSources(), nodeWikiFileSystem);
    pages = index.findTool(TOOL)?.pages ?? [];
  });

  const page = (slug: string): WikiPage | undefined => pages.find((candidate) => candidate.slug === slug);

  it("AC-34: should expose the index plus every topic page in reading order", () => {
    expect(pages.map((candidate) => candidate.slug)).toEqual(EXPECTED_PAGES);
  });

  it("AC-34: should give each page its position in reading order as its order, starting at 1", () => {
    expect(pages.map((candidate) => candidate.order)).toEqual(EXPECTED_PAGES.map((_, index) => index + 1));
  });

  it("AC-34: should give every page a non-empty title and a numeric order", () => {
    expect(pages).toHaveLength(EXPECTED_PAGES.length);
    for (const candidate of pages) {
      expect(candidate.title.trim().length, candidate.slug).toBeGreaterThan(0);
      expect(Number.isFinite(candidate.order), candidate.slug).toBe(true);
    }
  });

  it("AC-34: should use a unique order for every page", () => {
    const orders = pages.map((candidate) => candidate.order);

    expect(new Set(orders).size).toBe(orders.length);
  });

  it("AC-34: should resolve every Markdown link of the index to an existing topic", () => {
    const targets = [...(page("index")?.body.matchAll(INDEX_LINK) ?? [])].map((match) => match[1]);

    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      expect(EXPECTED_PAGES, target).toContain(target);
    }
  });

  it("AC-34: should link the index to every topic page", () => {
    const body = page("index")?.body ?? "";

    for (const topic of TOPIC_PAGES) {
      expect(body, topic).toContain(`(${topic}.md)`);
    }
  });

  it("AC-34: should resolve every relative Markdown link in every page to an existing page", () => {
    const slugs = new Set(pages.map((candidate) => candidate.slug));
    const links = pages.flatMap((candidate) =>
      [...candidate.body.matchAll(RELATIVE_MD_LINK)].map((match) => ({ from: candidate.slug, target: match[1] })),
    );

    expect(links.length).toBeGreaterThan(0);
    for (const { from, target } of links) {
      expect(slugs.has(target.replace(/\.md$/, "")), `${from} -> ${target}`).toBe(true);
    }
  });

  it("AC-34: should name the CSV file pattern and the Cambio header in the download topic", () => {
    const body = page("descargar-informe")?.body ?? "";

    expect(body).toContain("carto-");
    expect(body).toContain("Cambio");
  });

  it("AC-34: should contain no En construcción placeholder in any page", () => {
    expect(pages).toHaveLength(EXPECTED_PAGES.length);
    for (const candidate of pages) {
      expect(candidate.body, candidate.slug).not.toContain("En construcción");
    }
  });

  it("AC-34: should carry no screenshots", () => {
    expect(pages).toHaveLength(EXPECTED_PAGES.length);
    for (const candidate of pages) {
      expect(candidate.body, candidate.slug).not.toMatch(/!\[[^\]]*\]\(/);
    }
  });

  it("AC-34: should name the five wizard steps in the topic", () => {
    const body = page("cargar-padrones")?.body ?? "";

    for (const step of STEP_NAMES) {
      expect(body, step).toContain(step);
    }
  });

  it("AC-34: should name the options and buttons by their exact UI labels in the topic", () => {
    const body = page("cargar-padrones")?.body ?? "";

    for (const label of UI_LABELS) {
      expect(body, label).toContain(label);
    }
  });

  it("AC-34: should explain DELETE, TRUNCATE and the TRUNCATE privilege in the topic", () => {
    const body = page("cargar-padrones")?.body ?? "";

    expect(body).toContain("DELETE");
    expect(body).toContain("TRUNCATE");
    expect(body).toMatch(/privilegio/i);
  });

  it("AC-34: should cover the report, the warnings and the unknown outcome in the topic", () => {
    const body = page("cargar-padrones")?.body ?? "";

    expect(body).toMatch(/informe|reporte/i);
    expect(body).toMatch(/advertencias/i);
    expect(body).toMatch(/resultado incierto|incierto/i);
  });

  it("AC-34: should answer the dry-run question in the topic", () => {
    const body = page("cargar-padrones")?.body ?? "";

    expect(body).toMatch(/preguntas frecuentes/i);
    expect(body).toMatch(/simulaci[oó]n|sin modificar/i);
  });

  it("AC-34: should state the privilege needed to reset sequences that are not mapped", () => {
    const body = page("cargar-padrones")?.body ?? "";

    expect(body).toMatch(/secuencias/i);
    expect(body).toMatch(/privilegio[\s\S]{0,200}(USAGE|UPDATE)|(USAGE|UPDATE)[\s\S]{0,200}privilegio/i);
  });

  it("AC-34: should explain that Resultado incierto also appears after losing contact for about 60 seconds", () => {
    const body = page("cargar-padrones")?.body ?? "";

    expect(body).toMatch(/incierto[\s\S]{0,800}(60 s|60 segundos|un minuto)|(60 s|60 segundos|un minuto)[\s\S]{0,800}incierto/i);
  });

  it("AC-34: should document Eliminar perfil", () => {
    const body = page("cargar-padrones")?.body ?? "";

    expect(body).toContain("Eliminar perfil");
  });

  it("AC-34: should say that saving a profile with an existing name overwrites it", () => {
    const body = page("cargar-padrones")?.body ?? "";

    expect(body).toMatch(/mismo nombre|nombre (que )?ya existe|nombre existente|mismo nombre que otro/i);
    expect(body).toMatch(/sobrescribe|reemplaza|pisa/i);
  });

  describe("accuracy of the privileges and the unknown outcome", () => {
    const UNKNOWN_HEADING = '### ¿Qué significa "Resultado incierto"?';
    const UNKNOWN_OUTCOME_TEXT = "No se pudo confirmar el resultado de la carga";
    const TIME_REFERENCE = /alrededor de un minuto|más de un minuto|un minuto/;
    const DEFAULT_VALUE_TEXT = /nextval|valor por defecto|valores por defecto/i;

    const positionsOf = (text: string, pattern: RegExp): number[] => {
      const flags = pattern.flags.includes("i") ? "gi" : "g";
      return [...text.matchAll(new RegExp(pattern.source, flags))].map((match) => match.index ?? 0);
    };

    const anyPairWithin = (a: number[], b: number[], distance: number): boolean =>
      a.some((first) => b.some((second) => Math.abs(first - second) <= distance));

    const sectionOf = (text: string, heading: string): string => {
      const start = text.indexOf(heading);
      if (start < 0) return "";
      const next = text.indexOf("\n### ", start + heading.length);
      return text.slice(start, next < 0 ? text.length : next);
    };

    const bodyOf = (): string => page("cargar-padrones")?.body ?? "";

    it("AC-34: should name USAGE and UPDATE within 300 characters of each other near the word secuencias", () => {
      const body = bodyOf();
      const sequences = positionsOf(body, /secuencias/i);
      const usage = positionsOf(body, /USAGE/);
      const update = positionsOf(body, /UPDATE/);

      expect(sequences.length).toBeGreaterThan(0);
      const found = sequences.some(
        (at) =>
          usage.some((u) => Math.abs(u - at) <= 300) &&
          update.some((p) => Math.abs(p - at) <= 300) &&
          anyPairWithin(usage, update, 300),
      );
      expect(found).toBe(true);
    });

    it("AC-34: should name SELECT within 200 characters of the destination table", () => {
      const body = bodyOf();

      expect(anyPairWithin(positionsOf(body, /SELECT/), positionsOf(body, /tabla destino/i), 200)).toBe(true);
    });

    it("AC-34: should give the unknown-outcome section the exact UI text and a time reference", () => {
      const section = sectionOf(bodyOf(), UNKNOWN_HEADING);

      expect(section, "unknown-outcome section present").not.toBe("");
      expect(section).toContain(UNKNOWN_OUTCOME_TEXT);
      expect(section).toMatch(TIME_REFERENCE);
    });

    it("AC-34: should never claim the Resultado incierto banner text in the lost-contact paragraph", () => {
      const section = sectionOf(bodyOf(), UNKNOWN_HEADING);
      const lostContact = section
        .split(/\n\s*\n/)
        .filter((block) => !block.trim().startsWith("|") && block.includes("No se pudo confirmar"));

      expect(lostContact.length, "lost-contact paragraph present").toBeGreaterThan(0);
      for (const paragraph of lostContact) {
        expect(paragraph).not.toContain("Resultado incierto:");
      }
    });

    it("AC-34: should state that inserting needs USAGE or UPDATE on the sequences of columns with default values", () => {
      const body = bodyOf();

      expect(anyPairWithin(positionsOf(body, /USAGE|UPDATE/), positionsOf(body, DEFAULT_VALUE_TEXT), 300)).toBe(true);
    });

    it("AC-34: should state that inserting needs USAGE even when Reiniciar secuencias del destino is off", () => {
      const body = bodyOf();
      const usage = positionsOf(body, /USAGE/);
      const inserts = positionsOf(body, /INSERT|insertar|inserci[oó]n/i);
      const deactivated = positionsOf(body, /desactiv/i);

      const found = usage.some(
        (at) =>
          inserts.some((i) => Math.abs(i - at) <= 300) && deactivated.some((d) => Math.abs(d - at) <= 400),
      );
      expect(found).toBe(true);
    });
  });
});
