import { describe, it, expect } from "vitest";
import type { ReactElement, ReactNode } from "react";
import { AlertType } from "@/ui-kit/types/ui";
import type { FullReplaceResult } from "@/core/services/fullReplaceService";
import { FullReplaceSummary } from "@/components/tools/db-sync-common/FullReplaceSummary";

const baseResult: FullReplaceResult = {
  sourceRows: 3,
  insertedRows: 3,
  errorCount: 0,
  errors: [],
  ignoredSourceColumns: [],
  targetModified: true,
  sequencesAdjusted: [],
  analyze: { status: "ok" },
};

type Alert = { type: string; text: string };

const alertsOf = (node: ReactNode, found: Alert[] = []): Alert[] => {
  if (node === null || node === undefined || typeof node !== "object") return found;
  if (Array.isArray(node)) {
    node.forEach((child) => alertsOf(child, found));
    return found;
  }
  const element = node as ReactElement<{ type?: string; text?: string; children?: ReactNode }>;
  if (typeof element.props.text === "string") found.push({ type: String(element.props.type), text: element.props.text });
  alertsOf(element.props.children, found);
  return found;
};

const render = (overrides: Partial<FullReplaceResult> = {}) =>
  alertsOf(FullReplaceSummary({ result: { ...baseResult, ...overrides } }) as ReactNode);

describe("FullReplaceSummary", () => {
  describe("adjusted sequences lines", () => {
    const line = (label: string, nextValue: number) => `Secuencia ${label} ajustada: el próximo id será ${nextValue}.`;
    const sequenceAlerts = (overrides: Partial<FullReplaceResult>) =>
      render(overrides).filter((alert) => alert.text.startsWith("Secuencia "));

    it("should show one info line per adjusted sequence with the next id", () => {
      const alerts = sequenceAlerts({
        sequencesAdjusted: [
          { qualifiedLabel: "coverage.technology_3g_gid_seq", nextValue: 154186, resetToStart: false },
          { qualifiedLabel: "geo.b_seq", nextValue: 4, resetToStart: false },
        ],
      });
      expect(alerts).toEqual([
        { type: AlertType.INFO, text: line("coverage.technology_3g_gid_seq", 154186) },
        { type: AlertType.INFO, text: line("geo.b_seq", 4) },
      ]);
    });

    it("should append the reset note when the sequence was reset to 1 before the load", () => {
      const alerts = sequenceAlerts({
        sequencesAdjusted: [{ qualifiedLabel: "geo.a_seq", nextValue: 11, resetToStart: true }],
      });
      expect(alerts).toEqual([
        { type: AlertType.INFO, text: `${line("geo.a_seq", 11)} (se reinició en 1 antes de la carga).` },
      ]);
    });

    it("should keep the reset note per sequence when reset and non-reset sequences are mixed", () => {
      const alerts = sequenceAlerts({
        sequencesAdjusted: [
          { qualifiedLabel: "geo.a_seq", nextValue: 11, resetToStart: true },
          { qualifiedLabel: "geo.m_seq", nextValue: 110, resetToStart: false },
        ],
      });
      expect(alerts[0].text).toContain("(se reinició en 1 antes de la carga)");
      expect(alerts[1].text).toBe(line("geo.m_seq", 110));
    });

    it("should render no sequence line when no sequence was adjusted", () => {
      expect(sequenceAlerts({ sequencesAdjusted: [] })).toEqual([]);
    });

    it("should never claim the sequences ended reset at 1", () => {
      const texts = render({
        sequencesAdjusted: [{ qualifiedLabel: "geo.a_seq", nextValue: 11, resetToStart: true }],
      }).map((alert) => alert.text);
      expect(texts.some((text) => text.includes("reiniciadas en 1"))).toBe(false);
    });

    it("should show the lines even when the target was not modified because the first batch failed", () => {
      const alerts = sequenceAlerts({
        targetModified: false,
        errorCount: 1,
        errors: ["x"],
        insertedRows: 0,
        sequencesAdjusted: [{ qualifiedLabel: "geo.a_seq", nextValue: 4, resetToStart: false }],
      });
      expect(alerts).toEqual([{ type: AlertType.INFO, text: line("geo.a_seq", 4) }]);
    });
  });

  describe("ANALYZE outcome", () => {
    it("should show an info line when ANALYZE succeeded", () => {
      const alert = render({ analyze: { status: "ok" } }).find((a) => a.text.includes("ANALYZE"));
      expect(alert).toEqual({ type: AlertType.INFO, text: "ANALYZE enviado a la tabla destino." });
    });

    it("should never claim statistics were updated when ANALYZE succeeded", () => {
      const texts = render({ analyze: { status: "ok" } }).map((a) => a.text.toLowerCase());
      expect(texts.some((t) => t.includes("actualizadas") || t.includes("estadísticas de la tabla destino"))).toBe(false);
    });

    it("should show a WARNING with the message when ANALYZE failed", () => {
      const alert = render({ analyze: { status: "failed", message: "permission denied" } }).find((a) =>
        a.text.includes("ANALYZE")
      );
      expect(alert?.type).toBe(AlertType.WARNING);
      expect(alert?.text).toContain("ANALYZE falló");
      expect(alert?.text).toContain("permission denied");
    });

    it("should show a WARNING without trailing whitespace when ANALYZE failed without a message", () => {
      const alert = render({ analyze: { status: "failed" } }).find((a) => a.text.includes("ANALYZE"));
      expect(alert?.type).toBe(AlertType.WARNING);
      expect(alert?.text).toBe(alert?.text.trim());
    });

    it("should show a 'not executed' info line when ANALYZE was skipped", () => {
      const alert = render({ analyze: { status: "skipped" }, errorCount: 1, errors: ["x"] }).find((a) =>
        a.text.includes("ANALYZE")
      );
      expect(alert).toEqual({ type: AlertType.INFO, text: "ANALYZE no ejecutado: el reemplazo no terminó sin errores." });
    });

    it("should still report a successful replacement when ANALYZE failed", () => {
      const alerts = render({ analyze: { status: "failed", message: "boom" } });
      expect(alerts.some((a) => a.type === AlertType.SUCCESS)).toBe(true);
    });
  });
});
