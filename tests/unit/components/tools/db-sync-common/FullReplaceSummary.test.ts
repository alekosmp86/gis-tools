import { describe, it, expect } from "vitest";
import type { ReactElement, ReactNode } from "react";
import { AlertType } from "@/ui-kit/types/ui";
import type { FullReplaceResult } from "@/core/services/fullReplaceService";
import { GeometryRepairStatus } from "@/core/types/replace";
import { FullReplaceSummary } from "@/components/tools/db-sync-common/FullReplaceSummary";

const baseResult: FullReplaceResult = {
  sourceRows: 3,
  insertedRows: 3,
  errorCount: 0,
  replaceErrorCount: 0,
  errors: [],
  ignoredSourceColumns: [],
  targetModified: true,
  sequencesAdjusted: [],
  geometryRepair: { status: GeometryRepairStatus.OFF, columns: [], skippedColumns: [] },
  analyze: { status: "ok" },
};

const SUCCESS_TEXT = "Reemplazo completado: la tabla destino contiene todos los registros del origen.";
const INCOMPLETE_PREFIX = "Reemplazo incompleto";
const GEOMETRY_FAILED_TEXT = "Reparación de geometrías incompleta: la carga se conserva; vea los errores.";
const SEQUENCE_ERROR = "No se pudieron ajustar las secuencias: el servidor no devolvió el próximo id de geo.a_seq.";
const GEOMETRY_ERROR = "Reparación de geometrías: columna geom: boom";

type Alert = { type: string; text: string };

const alertsOf = (node: ReactNode, found: Alert[] = []): Alert[] => {
  if (node === null || node === undefined || typeof node !== "object") return found;
  if (Array.isArray(node)) {
    node.forEach((child) => alertsOf(child, found));
    return found;
  }
  const element = node as ReactElement<{ type?: string; text?: string; children?: ReactNode }>;
  if (typeof element.props.text === "string") {
    found.push({ type: String(element.props.type), text: element.props.text });
    return found;
  }
  if (typeof element.type === "function") {
    return alertsOf((element.type as (props: unknown) => ReactNode)(element.props), found);
  }
  alertsOf(element.props.children, found);
  return found;
};

const render = (overrides: Partial<FullReplaceResult> = {}) =>
  alertsOf(FullReplaceSummary({ result: { ...baseResult, ...overrides } }) as ReactNode);

const headlinesOf = (alerts: Alert[]) =>
  alerts.filter((alert) => alert.text.startsWith("Reemplazo completado") || alert.text.startsWith(INCOMPLETE_PREFIX));

describe("FullReplaceSummary", () => {
  describe("headline", () => {
    it("should show the success headline when the replace has no errors and every row was inserted", () => {
      expect(headlinesOf(render())).toEqual([{ type: AlertType.SUCCESS, text: SUCCESS_TEXT }]);
    });

    it("should show the incomplete warning when the replace script reported errors", () => {
      const alerts = render({ errorCount: 1, replaceErrorCount: 1, errors: ["Lote 2 (501-1000): violation"], insertedRows: 500 });
      const headlines = headlinesOf(alerts);
      expect(headlines).toHaveLength(1);
      expect(headlines[0].type).toBe(AlertType.WARNING);
      expect(headlines[0].text).toContain(INCOMPLETE_PREFIX);
    });

    it("should show the incomplete warning when the inserted rows differ from the source rows", () => {
      const alerts = render({ insertedRows: 2 });
      expect(headlinesOf(alerts)[0]).toMatchObject({ type: AlertType.WARNING });
    });

    it("should show the error alert and no headline when the target was not modified", () => {
      const alerts = render({ targetModified: false, insertedRows: 0, errorCount: 1, replaceErrorCount: 1, errors: ["x"] });
      expect(headlinesOf(alerts)).toEqual([]);
      expect(alerts.some((alert) => alert.type === AlertType.ERROR)).toBe(true);
    });
  });

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
        replaceErrorCount: 1,
        errors: ["x"],
        insertedRows: 0,
        sequencesAdjusted: [{ qualifiedLabel: "geo.a_seq", nextValue: 4, resetToStart: false }],
      });
      expect(alerts).toEqual([{ type: AlertType.INFO, text: line("geo.a_seq", 4) }]);
    });
  });

  describe("geometry repair line", () => {
    it("should show the 'sin reparación' line when the geometry repair is off", () => {
      const texts = render({ geometryRepair: { status: GeometryRepairStatus.OFF, columns: [], skippedColumns: [] } }).map(
        (alert) => alert.text
      );
      expect(texts).toContain(
        "Sin reparación de geometrías: las geometrías se cargaron tal como vienen del origen."
      );
    });

    it("should show the repaired row count per column when the geometry repair succeeded", () => {
      const alerts = render({
        geometryRepair: {
          status: GeometryRepairStatus.OK,
          columns: [{ column: "geom", repairedRows: 7, unrepairableRows: 0 }],
          skippedColumns: [],
        },
      });
      expect(alerts).toContainEqual({ type: AlertType.INFO, text: "Geometrías reparadas en geom: 7 filas." });
    });

    it("should show the unrepairable warning for a column with unrepairable rows", () => {
      const alerts = render({
        geometryRepair: {
          status: GeometryRepairStatus.OK,
          columns: [{ column: "geom", repairedRows: 7, unrepairableRows: 2 }],
          skippedColumns: [],
        },
      });
      expect(alerts.some((alert) => alert.type === AlertType.WARNING && alert.text.includes("2 filas no se pudieron reparar"))).toBe(true);
    });

    it("should show an info line for each skipped polygonal column", () => {
      const alerts = render({
        geometryRepair: { status: GeometryRepairStatus.OFF, columns: [], skippedColumns: ["poly", "mz"] },
      });
      expect(alerts).toContainEqual({ type: AlertType.INFO, text: "Columna poly omitida (tipo no soportado)." });
      expect(alerts).toContainEqual({ type: AlertType.INFO, text: "Columna mz omitida (tipo no soportado)." });
    });

    it("should keep the success headline when the geometry repair failed and the replace had no errors", () => {
      const alerts = render({
        geometryRepair: { status: GeometryRepairStatus.FAILED, columns: [], skippedColumns: [], message: "columna geom: boom" },
        errorCount: 1,
        replaceErrorCount: 0,
        errors: [GEOMETRY_ERROR],
      });
      const headlines = headlinesOf(alerts);
      expect(headlines).toEqual([{ type: AlertType.SUCCESS, text: SUCCESS_TEXT }]);
      expect(alerts.some((alert) => alert.text.startsWith(INCOMPLETE_PREFIX))).toBe(false);
      expect(alerts).toContainEqual({ type: AlertType.WARNING, text: GEOMETRY_FAILED_TEXT });
    });

    it("should keep the success headline when only the sequence repair failed", () => {
      const alerts = render({
        errorCount: 1,
        replaceErrorCount: 0,
        errors: [SEQUENCE_ERROR],
      });
      expect(headlinesOf(alerts)).toEqual([{ type: AlertType.SUCCESS, text: SUCCESS_TEXT }]);
    });

    it("should show the incomplete warning when the replace errors and the geometry repair also failed", () => {
      const alerts = render({
        errorCount: 2,
        replaceErrorCount: 1,
        errors: ["Lote 2 (501-1000): violation", GEOMETRY_ERROR],
        insertedRows: 500,
        geometryRepair: { status: GeometryRepairStatus.FAILED, columns: [], skippedColumns: [], message: "columna geom: boom" },
      });
      const headlines = headlinesOf(alerts);
      expect(headlines).toHaveLength(1);
      expect(headlines[0].type).toBe(AlertType.WARNING);
      expect(headlines[0].text.startsWith(INCOMPLETE_PREFIX)).toBe(true);
    });
  });

  describe("ANALYZE outcome", () => {
    it("should show an info line when ANALYZE succeeded", () => {
      const alert = render({ analyze: { status: "ok" } }).find((candidate) => candidate.text.includes("ANALYZE"));
      expect(alert).toEqual({ type: AlertType.INFO, text: "ANALYZE enviado a la tabla destino." });
    });

    it("should never claim statistics were updated when ANALYZE succeeded", () => {
      const texts = render({ analyze: { status: "ok" } }).map((alert) => alert.text.toLowerCase());
      expect(texts.some((text) => text.includes("actualizadas") || text.includes("estadísticas de la tabla destino"))).toBe(false);
    });

    it("should show a WARNING with the message when ANALYZE failed", () => {
      const alert = render({ analyze: { status: "failed", message: "permission denied" } }).find((candidate) =>
        candidate.text.includes("ANALYZE")
      );
      expect(alert?.type).toBe(AlertType.WARNING);
      expect(alert?.text).toContain("ANALYZE falló");
      expect(alert?.text).toContain("permission denied");
    });

    it("should show a WARNING without trailing whitespace when ANALYZE failed without a message", () => {
      const alert = render({ analyze: { status: "failed" } }).find((candidate) => candidate.text.includes("ANALYZE"));
      expect(alert?.type).toBe(AlertType.WARNING);
      expect(alert?.text).toBe(alert?.text.trim());
    });

    it("should show a 'not executed' info line when ANALYZE was skipped", () => {
      const alert = render({ analyze: { status: "skipped" }, errorCount: 1, replaceErrorCount: 1, errors: ["x"] }).find(
        (candidate) => candidate.text.includes("ANALYZE")
      );
      expect(alert).toEqual({ type: AlertType.INFO, text: "ANALYZE no ejecutado: el reemplazo no terminó sin errores." });
    });

    it("should still report a successful replacement when ANALYZE failed", () => {
      const alerts = render({ analyze: { status: "failed", message: "boom" } });
      expect(alerts.some((alert) => alert.type === AlertType.SUCCESS)).toBe(true);
    });
  });
});
