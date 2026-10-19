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
  sequencesReset: [],
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
  describe("sequences line", () => {
    it("should list the reset sequences when some were reset", () => {
      const alert = render({ sequencesReset: ["geo.a_seq", "geo.b_seq"] }).find((a) => a.text.startsWith("Secuencias reiniciadas"));
      expect(alert).toEqual({ type: AlertType.INFO, text: "Secuencias reiniciadas en 1: geo.a_seq, geo.b_seq." });
    });

    it("should omit the sequences line when none were reset", () => {
      expect(render({ sequencesReset: [] }).some((a) => a.text.includes("Secuencias reiniciadas"))).toBe(false);
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
