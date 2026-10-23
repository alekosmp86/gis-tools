import { describe, it, expect } from "vitest";
import {
  NoticeLevel,
  buildReportNotices,
  isReplaceBlocked,
  shouldOfferRepair,
  type ReportNotice,
} from "@/core/services/geometryReportNotices";
import {
  DEFAULT_GEOMETRY_PROCESSING,
  EMPTY_GEOMETRY_REPORT,
  OverlapPolicy,
  type GeometryProcessingOptions,
  type GeometryProcessingReport,
} from "@/core/types/geometryProcessing";

const report = (overrides: Partial<GeometryProcessingReport> = {}): GeometryProcessingReport => ({
  ...EMPTY_GEOMETRY_REPORT,
  ...overrides,
});

const withRepair = (enabled: boolean): GeometryProcessingOptions => ({
  ...DEFAULT_GEOMETRY_PROCESSING,
  repair: { enabled },
});

const withUnify = (keyFields: string[]): GeometryProcessingOptions => ({
  ...DEFAULT_GEOMETRY_PROCESSING,
  unify: { enabled: true, keyFields },
});

const withOverlaps = (policy: GeometryProcessingOptions["overlaps"]["policy"]): GeometryProcessingOptions => ({
  ...DEFAULT_GEOMETRY_PROCESSING,
  overlaps: { enabled: true, policy, minAreaM2: 1 },
});

const textsOf = (notices: ReportNotice[], level: ReportNotice["level"]): string[] =>
  notices.filter((notice) => notice.level === level).map((notice) => notice.text);

describe("geometryReportNotices", () => {
  describe("buildReportNotices", () => {
    describe("nothing noteworthy", () => {
      it("should return an empty list when the report is empty and every process is disabled", () => {
        expect(buildReportNotices(EMPTY_GEOMETRY_REPORT, DEFAULT_GEOMETRY_PROCESSING)).toEqual([]);
      });

      it("should return an empty list when repair is on and no geometry is invalid", () => {
        expect(buildReportNotices(report({ repaired: 0 }), withRepair(true))).toEqual([]);
      });

      it("should return an empty list when unify is disabled even if key fields are present", () => {
        const options: GeometryProcessingOptions = {
          ...DEFAULT_GEOMETRY_PROCESSING,
          unify: { enabled: false, keyFields: ["DEPTO"] },
        };

        expect(buildReportNotices(EMPTY_GEOMETRY_REPORT, options)).toEqual([]);
      });
    });

    describe("invalid geometries inserted without repair", () => {
      it("should return a WARNING with the plural count when repair is off and several invalid geometries were inserted", () => {
        const notices = buildReportNotices(report({ insertedInvalid: 3 }), withRepair(false));

        expect(notices).toEqual([
          expect.objectContaining({ level: NoticeLevel.WARNING }),
        ]);
        expect(textsOf(notices, NoticeLevel.WARNING)[0]).toContain(
          "3 geometrías inválidas se insertaron sin reparar"
        );
      });

      it("should return the exact singular wording when repair is off and one invalid geometry was inserted", () => {
        const notices = buildReportNotices(report({ insertedInvalid: 1 }), withRepair(false));

        expect(textsOf(notices, NoticeLevel.WARNING)).toEqual(["1 geometría inválida se insertó sin reparar"]);
      });

      it("should return a WARNING with the invalidBefore count when repair is off and no insert has happened yet", () => {
        const notices = buildReportNotices(report({ invalidBefore: 4, insertedInvalid: 0 }), withRepair(false));

        expect(textsOf(notices, NoticeLevel.WARNING)[0]).toContain(
          "4 geometrías inválidas se insertaron sin reparar"
        );
      });

      it("should use the inserted count rather than the invalidBefore count when both are present", () => {
        const notices = buildReportNotices(report({ invalidBefore: 4, insertedInvalid: 2 }), withRepair(false));

        expect(textsOf(notices, NoticeLevel.WARNING)[0]).toContain(
          "2 geometrías inválidas se insertaron sin reparar"
        );
      });

      it("should return no repair warning when repair is on even if invalid geometries were found", () => {
        const notices = buildReportNotices(report({ invalidBefore: 5, repaired: 5 }), withRepair(true));

        expect(notices.some((notice) => notice.text.includes("sin reparar"))).toBe(false);
      });

      it("should return no repair warning when repair is off and no geometry is invalid", () => {
        const notices = buildReportNotices(report({ invalidBefore: 0, insertedInvalid: 0 }), withRepair(false));

        expect(notices).toEqual([]);
      });
    });

    describe("overlap check skipped invalid geometries", () => {
      it("should return a WARNING with the exact plural text when overlaps are enabled and invalid geometries were skipped", () => {
        const notices = buildReportNotices(
          report({ overlapSkippedInvalid: 3 }),
          withOverlaps(OverlapPolicy.BLOCK)
        );

        expect(textsOf(notices, NoticeLevel.WARNING)).toContain(
          "3 geometrías inválidas no se comprobaron para solapes; active Reparar para incluirlas"
        );
      });

      it("should return a singular WARNING that mentions one invalid geometry when exactly one was skipped", () => {
        const notices = buildReportNotices(
          report({ overlapSkippedInvalid: 1 }),
          withOverlaps(OverlapPolicy.BLOCK)
        );
        const warnings = textsOf(notices, NoticeLevel.WARNING);

        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toMatch(/1 geometría inválida/);
        expect(warnings[0]).not.toMatch(/geometrías/);
        expect(warnings[0]).toMatch(/Reparar/);
      });

      it("should return no skipped-invalid warning when overlaps are disabled", () => {
        const notices = buildReportNotices(report({ overlapSkippedInvalid: 3 }), DEFAULT_GEOMETRY_PROCESSING);

        expect(notices).toEqual([]);
      });

      it("should return no skipped-invalid warning when repair is on and invalid geometries were skipped", () => {
        const options: GeometryProcessingOptions = {
          ...withOverlaps(OverlapPolicy.BLOCK),
          repair: { enabled: true },
        };

        const notices = buildReportNotices(report({ overlapSkippedInvalid: 3 }), options);

        expect(notices.some((notice) => notice.text.includes("no se comprobaron para solapes"))).toBe(false);
      });

      it("should return no singular skipped-invalid warning when repair is on and exactly one geometry was skipped", () => {
        const options: GeometryProcessingOptions = {
          ...withOverlaps(OverlapPolicy.BLOCK),
          repair: { enabled: true },
        };

        const notices = buildReportNotices(report({ overlapSkippedInvalid: 1 }), options);

        expect(notices.some((notice) => notice.text.includes("no se comprobó para solapes"))).toBe(false);
      });
    });

    describe("shouldOfferRepair", () => {
      it("should return false when repair is enabled even if invalid geometries were found", () => {
        expect(
          shouldOfferRepair(report({ invalidBefore: 3, insertedInvalid: 2 }), withRepair(true))
        ).toBe(false);
      });

      it("should return false when repair is disabled and no geometry is invalid", () => {
        expect(shouldOfferRepair(EMPTY_GEOMETRY_REPORT, withRepair(false))).toBe(false);
      });

      it("should return true when repair is disabled and only the unify-created invalid geometries were inserted", () => {
        expect(shouldOfferRepair(report({ invalidBefore: 0, insertedInvalid: 2 }), withRepair(false))).toBe(true);
      });

      it("should return true when repair is disabled and only the source geometries were invalid", () => {
        expect(shouldOfferRepair(report({ invalidBefore: 2, insertedInvalid: 0 }), withRepair(false))).toBe(true);
      });

      it("should return true when repair is disabled and both counts are positive", () => {
        expect(shouldOfferRepair(report({ invalidBefore: 2, insertedInvalid: 1 }), withRepair(false))).toBe(true);
      });
    });

    describe("unify rows with a NULL key", () => {
      it("should return a WARNING with the plural count when unify left several rows with an empty key", () => {
        const notices = buildReportNotices(report({ nullKeyRows: 2 }), withUnify(["DEPTO", "PADRON"]));

        expect(textsOf(notices, NoticeLevel.WARNING)).toEqual([
          "2 registros con clave vacía no se unificaron",
        ]);
      });

      it("should return the singular WARNING when exactly one row has an empty key", () => {
        const notices = buildReportNotices(report({ nullKeyRows: 1 }), withUnify(["DEPTO", "PADRON"]));

        expect(textsOf(notices, NoticeLevel.WARNING)).toEqual(["1 registro con clave vacía no se unificó"]);
      });

      it("should return no empty-key WARNING when no row has an empty key", () => {
        const notices = buildReportNotices(report({ nullKeyRows: 0 }), withUnify(["DEPTO", "PADRON"]));

        expect(textsOf(notices, NoticeLevel.WARNING)).toEqual([]);
      });

      it("should return no empty-key WARNING when unify is disabled even if rows have an empty key", () => {
        const notices = buildReportNotices(report({ nullKeyRows: 2 }), DEFAULT_GEOMETRY_PROCESSING);

        expect(notices).toEqual([]);
      });

      it("should report zero nullKeyRows in the empty report", () => {
        expect(EMPTY_GEOMETRY_REPORT.nullKeyRows).toBe(0);
      });
    });

    describe("attribute conflicts", () => {
      it("should return a WARNING that mentions the conflict count and the kept first value", () => {
        const notices = buildReportNotices(report({ attributeConflicts: 2, groups: 2, rowsMerged: 4 }), withUnify(["DEPTO", "PADRON"]));
        const warnings = textsOf(notices, NoticeLevel.WARNING);

        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toMatch(/\b2\b/);
        expect(warnings[0]).toMatch(/primer/i);
      });

      it("should return no conflict WARNING when attribute conflicts is zero", () => {
        const notices = buildReportNotices(report({ attributeConflicts: 0 }), withUnify(["DEPTO", "PADRON"]));

        expect(textsOf(notices, NoticeLevel.WARNING)).toEqual([]);
      });
    });

    describe("empty geometries after repair", () => {
      it("should return a WARNING with the count and the phrase quedaron vacías tras la reparación", () => {
        const notices = buildReportNotices(report({ emptyAfterRepair: 6 }), withRepair(true));
        const warnings = textsOf(notices, NoticeLevel.WARNING);

        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain("6");
        expect(warnings[0]).toContain("quedaron vacías tras la reparación");
      });

      it("should return no empty-geometry WARNING when no geometry became empty", () => {
        const notices = buildReportNotices(report({ emptyAfterRepair: 0 }), withRepair(true));

        expect(textsOf(notices, NoticeLevel.WARNING)).toEqual([]);
      });
    });

    describe("blocking overlaps", () => {
      it("should return an ERROR that mentions the overlap count and Bloquear when the report would block", () => {
        const notices = buildReportNotices(
          report({ wouldBlock: true, overlapCount: 4 }),
          withOverlaps(OverlapPolicy.BLOCK)
        );
        const errors = textsOf(notices, NoticeLevel.ERROR);

        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain("4");
        expect(errors[0]).toContain("Bloquear");
      });

      it("should return no ERROR when the report would not block", () => {
        const notices = buildReportNotices(
          report({ wouldBlock: false, overlapCount: 4 }),
          withOverlaps(OverlapPolicy.BLOCK)
        );

        expect(textsOf(notices, NoticeLevel.ERROR)).toEqual([]);
      });
    });

    describe("overlaps under the report policy", () => {
      it("should return a WARNING with the overlap count when the policy is report and overlaps exist", () => {
        const notices = buildReportNotices(
          report({ overlapCount: 7 }),
          withOverlaps(OverlapPolicy.REPORT)
        );
        const warnings = textsOf(notices, NoticeLevel.WARNING);

        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain("7");
      });

      it("should return no overlap WARNING when the policy is block and the report would not block", () => {
        const notices = buildReportNotices(
          report({ overlapCount: 7, wouldBlock: false }),
          withOverlaps(OverlapPolicy.BLOCK)
        );

        expect(textsOf(notices, NoticeLevel.WARNING)).toEqual([]);
      });

      it("should return no overlap WARNING when overlaps are disabled even if the report counts overlaps", () => {
        const notices = buildReportNotices(report({ overlapCount: 7 }), DEFAULT_GEOMETRY_PROCESSING);

        expect(notices).toEqual([]);
      });
    });

    describe("unify key with a single field", () => {
      it("should return an INFO warning that a single-field key may merge unrelated records", () => {
        const notices = buildReportNotices(report({ groups: 1, rowsMerged: 1 }), withUnify(["PADRON"]));
        const infos = textsOf(notices, NoticeLevel.INFO);

        expect(infos).toHaveLength(2);
        expect(infos[0]).toMatch(/campo/i);
        expect(infos[0]).toMatch(/registros/i);
        expect(infos[1]).toBe("1 grupo, 1 registro fusionado");
      });

      it("should return no single-field INFO when the key has two fields", () => {
        const notices = buildReportNotices(report({ groups: 1, rowsMerged: 1 }), withUnify(["DEPTO", "PADRON"]));

        expect(textsOf(notices, NoticeLevel.INFO)).toEqual(["1 grupo, 1 registro fusionado"]);
      });

      it("should return no single-field INFO when unify is disabled and one key field is set", () => {
        const options: GeometryProcessingOptions = {
          ...DEFAULT_GEOMETRY_PROCESSING,
          unify: { enabled: false, keyFields: ["PADRON"] },
        };

        expect(buildReportNotices(report(), options)).toEqual([]);
      });
    });

    describe("unify groups summary", () => {
      it("should return an INFO with the exact groups and merged rows text when unify produced groups", () => {
        const notices = buildReportNotices(
          report({ groups: 3, rowsMerged: 5 }),
          withUnify(["DEPTO", "PADRON"])
        );

        expect(textsOf(notices, NoticeLevel.INFO)).toContain("3 grupos, 5 registros fusionados");
      });

      it("should return no groups INFO when unify is disabled even if the report has groups", () => {
        const notices = buildReportNotices(report({ groups: 3, rowsMerged: 5 }), DEFAULT_GEOMETRY_PROCESSING);

        expect(notices).toEqual([]);
      });

      it("should return no groups INFO when rowsMerged is zero even though the report counts groups", () => {
        const notices = buildReportNotices(report({ groups: 5, rowsMerged: 0 }), withUnify(["DEPTO", "PADRON"]));

        expect(textsOf(notices, NoticeLevel.INFO)).not.toContain("5 grupos, 0 registros fusionados");
        expect(textsOf(notices, NoticeLevel.INFO).some((text) => text.includes("fusionad"))).toBe(false);
      });

      it("should return no groups INFO when the report has zero groups and zero merged rows", () => {
        const notices = buildReportNotices(report({ groups: 0, rowsMerged: 0 }), withUnify(["DEPTO", "PADRON"]));

        expect(textsOf(notices, NoticeLevel.INFO).some((text) => text.includes("fusionad"))).toBe(false);
      });
    });

    describe("unify key that merges nothing", () => {
      const NO_MERGE_TEXT =
        "La clave elegida no agrupa registros: cada grupo tiene 1 registro, no se unificará nada. Revise los campos de la clave.";

      it("should return the exact INFO when unify is enabled and rowsMerged is zero", () => {
        const notices = buildReportNotices(report({ groups: 4, rowsMerged: 0 }), withUnify(["DEPTO", "PADRON"]));

        expect(notices).toEqual([{ level: NoticeLevel.INFO, text: NO_MERGE_TEXT }]);
      });

      it("should return the INFO when unify is enabled and the report has no groups at all", () => {
        const notices = buildReportNotices(report({ groups: 0, rowsMerged: 0 }), withUnify(["DEPTO", "PADRON"]));

        expect(textsOf(notices, NoticeLevel.INFO)).toEqual([NO_MERGE_TEXT]);
      });

      it("should return no merge-nothing INFO when unify is disabled and rowsMerged is zero", () => {
        const notices = buildReportNotices(report({ groups: 4, rowsMerged: 0 }), DEFAULT_GEOMETRY_PROCESSING);

        expect(notices).toEqual([]);
      });

      it("should return no merge-nothing INFO when rowsMerged is greater than zero", () => {
        const notices = buildReportNotices(report({ groups: 2, rowsMerged: 1 }), withUnify(["DEPTO", "PADRON"]));

        expect(textsOf(notices, NoticeLevel.INFO)).not.toContain(NO_MERGE_TEXT);
        expect(textsOf(notices, NoticeLevel.INFO)).toEqual(["2 grupos, 1 registro fusionado"]);
      });

      it("should never return the groups summary together with the merge-nothing INFO", () => {
        const notices = buildReportNotices(report({ groups: 3, rowsMerged: 0 }), withUnify(["DEPTO", "PADRON"]));
        const infos = textsOf(notices, NoticeLevel.INFO);

        expect(infos).toEqual([NO_MERGE_TEXT]);
        expect(infos.some((text) => text.includes("grupos,"))).toBe(false);
      });

      it("should keep the merge-nothing INFO after the single-field INFO when both apply", () => {
        const notices = buildReportNotices(report({ groups: 3, rowsMerged: 0 }), withUnify(["PADRON"]));

        expect(textsOf(notices, NoticeLevel.INFO)).toEqual([expect.stringContaining("un solo campo"), NO_MERGE_TEXT]);
      });

      it("should keep the merge-nothing INFO as the only INFO beside WARNINGs and not reorder levels", () => {
        const notices = buildReportNotices(
          report({ nullKeyRows: 2, attributeConflicts: 0, groups: 3, rowsMerged: 0 }),
          withUnify(["DEPTO", "PADRON"])
        );

        expect(notices.map((notice) => notice.level)).toEqual([NoticeLevel.WARNING, NoticeLevel.INFO]);
        expect(notices[0].text).toBe("2 registros con clave vacía no se unificaron");
        expect(notices[1].text).toBe(NO_MERGE_TEXT);
      });
    });

    describe("ordering", () => {
      it("should return the ERROR first, then WARNING, then INFO when all three levels are present", () => {
        const options: GeometryProcessingOptions = {
          repair: { enabled: false },
          unify: { enabled: true, keyFields: ["DEPTO", "PADRON"] },
          overlaps: { enabled: true, policy: OverlapPolicy.BLOCK, minAreaM2: 1 },
        };

        const notices = buildReportNotices(
          report({ wouldBlock: true, overlapCount: 2, attributeConflicts: 1, groups: 2, rowsMerged: 3 }),
          options
        );

        expect(notices.map((notice) => notice.level)).toEqual([
          NoticeLevel.ERROR,
          NoticeLevel.WARNING,
          NoticeLevel.INFO,
        ]);
      });

      it("should return the INFO notices after every WARNING even when the single-field INFO is produced", () => {
        const options: GeometryProcessingOptions = {
          ...DEFAULT_GEOMETRY_PROCESSING,
          unify: { enabled: true, keyFields: ["PADRON"] },
        };

        const notices = buildReportNotices(report({ attributeConflicts: 1, groups: 2, rowsMerged: 3 }), options);

        const levels = notices.map((notice) => notice.level);
        expect(levels.lastIndexOf(NoticeLevel.WARNING)).toBeLessThan(levels.indexOf(NoticeLevel.INFO));
        expect(levels.filter((level) => level === NoticeLevel.INFO)).toHaveLength(2);
      });
    });

    describe("incompatible multi-part geometries", () => {
      const SINGULAR_TEXT = "1 geometría MultiPolígono no cabe en la columna destino de tipo Polígono";
      const PLURAL_TEXT = "3 geometrías MultiPolígono no caben en la columna destino de tipo Polígono";

      it("should return an ERROR with the plural wording when several multi-part geometries do not fit a Polygon column", () => {
        const notices = buildReportNotices(report({ incompatibleGeometryRows: 3 }), DEFAULT_GEOMETRY_PROCESSING);

        expect(notices).toContainEqual({ level: NoticeLevel.ERROR, text: PLURAL_TEXT });
      });

      it("should return an ERROR with the exact singular wording when one multi-part geometry does not fit a Polygon column", () => {
        const notices = buildReportNotices(report({ incompatibleGeometryRows: 1 }), DEFAULT_GEOMETRY_PROCESSING);

        expect(textsOf(notices, NoticeLevel.ERROR)).toEqual([SINGULAR_TEXT]);
      });

      it("should return no incompatible-geometry ERROR when the incompatible count is zero", () => {
        const notices = buildReportNotices(report({ incompatibleGeometryRows: 0 }), DEFAULT_GEOMETRY_PROCESSING);

        expect(notices.some((notice) => notice.text.includes("no cabe") || notice.text.includes("no caben"))).toBe(false);
      });

      it("should return the incompatible-geometry ERROR before every WARNING and INFO notice", () => {
        const options: GeometryProcessingOptions = {
          ...DEFAULT_GEOMETRY_PROCESSING,
          repair: { enabled: false },
          unify: { enabled: true, keyFields: ["DEPTO", "PADRON"] },
        };

        const notices = buildReportNotices(
          report({ incompatibleGeometryRows: 2, invalidBefore: 1, insertedInvalid: 1, attributeConflicts: 1, groups: 2, rowsMerged: 3 }),
          options
        );

        const incompatibleIndex = notices.findIndex((notice) => notice.text.includes("MultiPolígono"));
        const firstWarningIndex = notices.findIndex((notice) => notice.level === NoticeLevel.WARNING);
        expect(notices[incompatibleIndex].level).toBe(NoticeLevel.ERROR);
        expect(incompatibleIndex).toBeLessThan(firstWarningIndex);
        expect(notices.map((notice) => notice.level).slice(0, 1)).toEqual([NoticeLevel.ERROR]);
      });

      it("should return the incompatible-geometry ERROR alongside a blocking overlap ERROR and keep all ERRORs before WARNINGs", () => {
        const options: GeometryProcessingOptions = {
          ...DEFAULT_GEOMETRY_PROCESSING,
          overlaps: { enabled: true, policy: OverlapPolicy.BLOCK, minAreaM2: 1 },
        };

        const notices = buildReportNotices(
          report({ incompatibleGeometryRows: 1, wouldBlock: true, overlapCount: 2, overlapSkippedInvalid: 1 }),
          options
        );

        const levels = notices.map((notice) => notice.level);
        expect(textsOf(notices, NoticeLevel.ERROR)).toContain(SINGULAR_TEXT);
        expect(levels.lastIndexOf(NoticeLevel.ERROR)).toBeLessThan(levels.indexOf(NoticeLevel.WARNING));
      });
    });

    describe("isReplaceBlocked", () => {
      it("should return false when the report is empty", () => {
        expect(isReplaceBlocked(EMPTY_GEOMETRY_REPORT)).toBe(false);
      });

      it("should return true when the overlap policy would block the replace", () => {
        expect(isReplaceBlocked(report({ wouldBlock: true }))).toBe(true);
      });

      it("should return true when incompatible multi-part geometries exist even if no overlap would block", () => {
        expect(isReplaceBlocked(report({ wouldBlock: false, incompatibleGeometryRows: 1 }))).toBe(true);
      });

      it("should return true when both a blocking overlap and incompatible geometries are present", () => {
        expect(isReplaceBlocked(report({ wouldBlock: true, incompatibleGeometryRows: 4 }))).toBe(true);
      });

      it("should return false when neither blocking overlaps nor incompatible geometries are present but invalid geometries were inserted", () => {
        expect(isReplaceBlocked(report({ wouldBlock: false, incompatibleGeometryRows: 0, insertedInvalid: 2 }))).toBe(false);
      });
    });
  });
});
