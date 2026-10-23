import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, vi } from "vitest";
import { ShpReplaceFollowUp, type ShpReplaceFollowUpProps } from "@/components/tools/db-shapefile-sync/ShpReplaceFollowUp";
import styles from "@/components/tools/db-shapefile-sync/ShpReplaceFollowUp.module.css";
import {
  DEFAULT_GEOMETRY_PROCESSING,
  EMPTY_GEOMETRY_REPORT,
  type GeometryProcessingOptions,
  type GeometryProcessingReport,
} from "@/core/types/geometryProcessing";

const REPAIR_OFF: GeometryProcessingOptions = { ...DEFAULT_GEOMETRY_PROCESSING, repair: { enabled: false } };
const REPAIR_ON: GeometryProcessingOptions = { ...DEFAULT_GEOMETRY_PROCESSING, repair: { enabled: true } };
const TARGET_LABEL = "geo.padron";
const REPLACE_LABEL = "Reemplazar ahora";
const REPAIR_PROMPT_TITLE = "¿Reparar?";
const ACTIVATE_REPAIR_LABEL = "Activar reparación y volver a analizar";
const CONTINUE_WITHOUT_REPAIR_LABEL = "Continuar sin reparar";

const reportOf = (overrides: Partial<GeometryProcessingReport> = {}): GeometryProcessingReport => ({
  ...EMPTY_GEOMETRY_REPORT,
  ...overrides,
});

const renderFollowUp = (overrides: Partial<ShpReplaceFollowUpProps> = {}): string => {
  const props: ShpReplaceFollowUpProps = {
    report: reportOf(),
    processing: REPAIR_OFF,
    targetLabel: TARGET_LABEL,
    canReplace: true,
    onRerun: vi.fn(),
    onReconfigure: vi.fn(),
    onNewOperation: vi.fn(),
    ...overrides,
  };
  return renderToStaticMarkup(React.createElement(ShpReplaceFollowUp, props));
};

/** Opening tag of the first <button> whose content includes the label. */
const buttonTagOf = (html: string, label: string): string => {
  const segment = html.split("<button").slice(1).find((candidate) => candidate.includes(label));
  return segment ? segment.split(">")[0] : "";
};

const isDisabled = (html: string, label: string): boolean => / disabled(=""|\s|$)/.test(buttonTagOf(html, label));

describe("ShpReplaceFollowUp", () => {
  describe("replace controls", () => {
    it("should not render the replace button or its inputs when the analysis cannot be replaced", () => {
      const html = renderFollowUp({ canReplace: false });

      expect(html).not.toContain(REPLACE_LABEL);
      expect(html).not.toContain('type="password"');
      expect(html).not.toContain("Para confirmar el reemplazo");
    });

    it("should render the password input and the confirmation label when the analysis can be replaced", () => {
      const html = renderFollowUp();

      expect(html).toContain('type="password"');
      expect(html).toContain("Contraseña de PostgreSQL del destino");
      expect(html).toContain(`<code class="${styles.code}">${TARGET_LABEL}</code>`);
    });

    it("should render Reemplazar ahora disabled in its initial state when no password and no label are typed", () => {
      const html = renderFollowUp();

      expect(html).toContain(REPLACE_LABEL);
      expect(isDisabled(html, REPLACE_LABEL)).toBe(true);
    });

    it("should keep Reemplazar ahora disabled for a report that would block the replace", () => {
      const html = renderFollowUp({ report: reportOf({ wouldBlock: true }) });

      expect(isDisabled(html, REPLACE_LABEL)).toBe(true);
    });

    it("should keep Reemplazar ahora disabled for a report with incompatible multi-part geometries", () => {
      const html = renderFollowUp({
        report: reportOf({ incompatibleGeometryRows: 2, incompatibleTargetType: "Polígono" }),
      });

      expect(isDisabled(html, REPLACE_LABEL)).toBe(true);
    });

    it("should keep Reemplazar ahora disabled for a clean report until the password and label are typed", () => {
      const html = renderFollowUp({ report: reportOf({ insertedInvalid: 0, invalidBefore: 0 }) });

      expect(isDisabled(html, REPLACE_LABEL)).toBe(true);
    });
  });

  describe("footer navigation", () => {
    it("should render Nueva operación before Volver a configurar and Reemplazar ahora", () => {
      const html = renderFollowUp();

      const newOperationAt = html.indexOf("Nueva operación");
      const reconfigureAt = html.indexOf("Volver a configurar");
      const replaceAt = html.indexOf(REPLACE_LABEL);
      expect(newOperationAt).toBeGreaterThanOrEqual(0);
      expect(newOperationAt).toBeLessThan(reconfigureAt);
      expect(reconfigureAt).toBeLessThan(replaceAt);
    });

    it("should render Volver a configurar enabled even when the replace is blocked", () => {
      const html = renderFollowUp({ report: reportOf({ wouldBlock: true }) });

      expect(html).toContain("Volver a configurar");
      expect(isDisabled(html, "Volver a configurar")).toBe(false);
    });
  });

  describe("repair prompt", () => {
    it("should render the repair prompt when invalid geometries were found and repair is disabled", () => {
      const html = renderFollowUp({ report: reportOf({ invalidBefore: 2 }), processing: REPAIR_OFF });

      expect(html).toContain(REPAIR_PROMPT_TITLE);
      expect(html).toContain(CONTINUE_WITHOUT_REPAIR_LABEL);
      expect(html).toContain(ACTIVATE_REPAIR_LABEL);
    });

    it("should render the repair prompt when only the inserted geometries are invalid", () => {
      const html = renderFollowUp({ report: reportOf({ invalidBefore: 0, insertedInvalid: 2 }), processing: REPAIR_OFF });

      expect(html).toContain(REPAIR_PROMPT_TITLE);
    });

    it("should not render the repair prompt when repair is already enabled", () => {
      const html = renderFollowUp({ report: reportOf({ invalidBefore: 2 }), processing: REPAIR_ON });

      expect(html).not.toContain(REPAIR_PROMPT_TITLE);
    });

    it("should not render the repair prompt when no geometry is invalid", () => {
      const html = renderFollowUp({ report: reportOf({ invalidBefore: 0, insertedInvalid: 0 }), processing: REPAIR_OFF });

      expect(html).not.toContain(REPAIR_PROMPT_TITLE);
    });

    it("should not render the repair prompt when the analysis cannot be replaced", () => {
      const html = renderFollowUp({ report: reportOf({ invalidBefore: 2 }), processing: REPAIR_OFF, canReplace: false });

      expect(html).not.toContain(REPAIR_PROMPT_TITLE);
    });

    it("should render the activate-repair action disabled until a password is typed", () => {
      const html = renderFollowUp({ report: reportOf({ invalidBefore: 2 }), processing: REPAIR_OFF });

      expect(isDisabled(html, ACTIVATE_REPAIR_LABEL)).toBe(true);
      expect(isDisabled(html, CONTINUE_WITHOUT_REPAIR_LABEL)).toBe(false);
    });
  });
});
