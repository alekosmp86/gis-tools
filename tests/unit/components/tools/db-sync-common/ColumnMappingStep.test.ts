import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, vi } from "vitest";
import { ColumnMappingStep, type ColumnMappingStepProps } from "@/components/tools/db-sync-common/ColumnMappingStep";
import styles from "@/components/tools/db-sync-common/ColumnMappingStep.module.css";
import { MatchKind } from "@/core/services/columnAutoMapper";
import type { DbColumnMetadata } from "@/core/types/db";

const column = (column_name: string, data_type: string, is_nullable = true, column_default: string | null = null): DbColumnMetadata => ({
  column_name,
  data_type,
  is_nullable,
  column_default,
});

const TARGET_COLUMNS = ["gid", "padron", "caudricula"];
const TARGET_DETAILS = [column("gid", "integer", false), column("padron", "text"), column("caudricula", "text")];
const SOURCE_COLUMNS = ["PADRON", "CUADRICULA"];
const SOURCE_DETAILS = [column("PADRON", "text"), column("CUADRICULA", "text")];
const MAPPING = {
  sourceByTarget: { gid: null, padron: "PADRON", caudricula: "CUADRICULA" },
  defaults: {},
};

const CASE_INSENSITIVE_TITLE = "coincide sin distinguir mayúsculas";
const SIMILAR_TITLE = "nombre parecido: revíselo";
const EXACT_TITLE = "coincide por nombre exacto";

const renderStep = (overrides: Partial<ColumnMappingStepProps> = {}): string => {
  const props: ColumnMappingStepProps = {
    sourceColumns: SOURCE_COLUMNS,
    sourceDetails: SOURCE_DETAILS,
    targetColumns: TARGET_COLUMNS,
    targetDetails: TARGET_DETAILS,
    mapping: MAPPING,
    onSourceChange: vi.fn(),
    onDefaultChange: vi.fn(),
    ...overrides,
  };
  return renderToStaticMarkup(React.createElement(ColumnMappingStep, props));
};

const chipOpeningTags = (html: string): string[] => html.match(/<span class="[^"]*" title="[^"]*">Auto<\/span>/g) ?? [];

const chipClassWithTitle = (html: string, title: string): string => {
  const chip = chipOpeningTags(html).find((candidate) => candidate.includes(`title="${title}"`));
  return chip ? (/class="([^"]*)"/.exec(chip)?.[1] ?? "") : "";
};

describe("ColumnMappingStep", () => {
  describe("without automatic matches", () => {
    it("should render no Auto chip and no summary when autoMatches is not provided", () => {
      const html = renderStep();

      expect(chipOpeningTags(html)).toEqual([]);
      expect(html).not.toContain("Se asignaron");
    });

    it("should still render each target row with its selected source when no automatic matches are provided", () => {
      const html = renderStep();

      expect(html).toContain('aria-label="Columna origen para padron"');
      expect(html).toContain('aria-label="Columna origen para caudricula"');
    });
  });

  describe("with automatic matches", () => {
    it("should render one Auto chip per automatically matched and mapped target", () => {
      const html = renderStep({
        autoMatches: { padron: MatchKind.CASE_INSENSITIVE, caudricula: MatchKind.SIMILAR },
      });

      expect(chipOpeningTags(html)).toHaveLength(2);
      expect(html).toContain(`title="${CASE_INSENSITIVE_TITLE}"`);
      expect(html).toContain(`title="${SIMILAR_TITLE}"`);
    });

    it("should render the summary counting automatic matches over the target columns", () => {
      const html = renderStep({
        autoMatches: { padron: MatchKind.CASE_INSENSITIVE, caudricula: MatchKind.SIMILAR },
      });

      expect(html).toContain("Se asignaron 2 de 3 columnas automáticamente. Revise las marcadas.");
    });

    it("should render the zero-of-N summary when autoMatches is an empty object", () => {
      const html = renderStep({ autoMatches: {} });

      expect(html).toContain("Se asignaron 0 de 3 columnas automáticamente.");
      expect(chipOpeningTags(html)).toEqual([]);
    });

    it("should style a similar-name match with the review class", () => {
      const html = renderStep({ autoMatches: { caudricula: MatchKind.SIMILAR } });

      expect(chipClassWithTitle(html, SIMILAR_TITLE)).toContain(styles.autoChipReview);
    });

    it("should not style a case-insensitive match with the review class", () => {
      const html = renderStep({ autoMatches: { padron: MatchKind.CASE_INSENSITIVE } });

      const chipClass = chipClassWithTitle(html, CASE_INSENSITIVE_TITLE);
      expect(chipClass).toContain(styles.autoChip);
      expect(chipClass).not.toContain(styles.autoChipReview);
    });

    it("should label an exact-name match with its exact-name title", () => {
      const html = renderStep({ autoMatches: { padron: MatchKind.EXACT } });

      expect(html).toContain(`title="${EXACT_TITLE}"`);
    });

    it("should render no chip for a target the user left unmapped even when autoMatches lists it", () => {
      const html = renderStep({ autoMatches: { gid: MatchKind.EXACT } });

      expect(chipOpeningTags(html)).toEqual([]);
      expect(html).toContain("Se asignaron 1 de 3 columnas automáticamente.");
    });
  });
});
