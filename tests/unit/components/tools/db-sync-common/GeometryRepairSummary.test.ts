import { describe, it, expect } from "vitest";
import type { ReactElement, ReactNode } from "react";
import { AlertType } from "@/ui-kit/types/ui";
import { GeometryRepairStatus, type GeometryRepairOutcome } from "@/core/types/replace";
import { GeometryRepairSummary } from "@/components/tools/db-sync-common/GeometryRepairSummary";

type Alert = { type: string; text: string };
type AnyElement = ReactElement<{ type?: string; text?: string; children?: ReactNode } & Record<string, unknown>>;

const alertsOf = (node: ReactNode, found: Alert[] = []): Alert[] => {
  if (node === null || node === undefined || typeof node !== "object") return found;
  if (Array.isArray(node)) {
    node.forEach((child) => alertsOf(child, found));
    return found;
  }
  const element = node as AnyElement;
  if (typeof element.props.text === "string") {
    found.push({ type: String(element.props.type), text: element.props.text });
    return found;
  }
  if (typeof element.type === "function") {
    return alertsOf((element.type as (props: unknown) => ReactNode)(element.props), found);
  }
  return alertsOf(element.props.children, found);
};

const render = (outcome: GeometryRepairOutcome): Alert[] =>
  alertsOf(GeometryRepairSummary({ outcome }) as ReactNode);

const OFF_TEXT = "Sin reparación de geometrías: las geometrías se cargaron tal como vienen del origen.";
const SKIPPED_TEXT = "Reparación de geometrías no ejecutada: el reemplazo no terminó sin errores.";
const NO_POLYGONAL_FRAGMENT = "no tiene columnas poligonales";
const FAILED_TEXT = "Reparación de geometrías incompleta: la carga se conserva; vea los errores.";
const UNREPAIRABLE_FRAGMENT = "filas no se pudieron reparar y conservan su geometría original";
const repairedLine = (column: string, rows: number) => `Geometrías reparadas en ${column}: ${rows} filas.`;
const skippedLine = (column: string) => `Columna ${column} omitida (tipo no soportado).`;

describe("GeometryRepairSummary", () => {
  describe("repair off", () => {
    it("should show a single info line saying the geometries were loaded as they come when status is off", () => {
      expect(render({ status: GeometryRepairStatus.OFF, columns: [], skippedColumns: [] })).toEqual([
        { type: AlertType.INFO, text: OFF_TEXT },
      ]);
    });

    it("should not list any repaired column when status is off even if columns are present", () => {
      const alerts = render({
        status: GeometryRepairStatus.OFF,
        columns: [{ column: "geom", repairedRows: 5, unrepairableRows: 0 }],
        skippedColumns: [],
      });
      expect(alerts).toEqual([{ type: AlertType.INFO, text: OFF_TEXT }]);
    });

    it("should still list the skipped polygonal columns when status is off", () => {
      expect(render({ status: GeometryRepairStatus.OFF, columns: [], skippedColumns: ["poly"] })).toEqual([
        { type: AlertType.INFO, text: OFF_TEXT },
        { type: AlertType.INFO, text: skippedLine("poly") },
      ]);
    });
  });

  describe("repair skipped", () => {
    it("should show a single info line saying the repair did not run when status is skipped", () => {
      expect(render({ status: GeometryRepairStatus.SKIPPED, columns: [], skippedColumns: [] })).toEqual([
        { type: AlertType.INFO, text: SKIPPED_TEXT },
      ]);
    });

    it("should still list the skipped polygonal columns when status is skipped", () => {
      expect(render({ status: GeometryRepairStatus.SKIPPED, columns: [], skippedColumns: ["mz", "poly"] })).toEqual([
        { type: AlertType.INFO, text: SKIPPED_TEXT },
        { type: AlertType.INFO, text: skippedLine("mz") },
        { type: AlertType.INFO, text: skippedLine("poly") },
      ]);
    });
  });

  describe("repair ok", () => {
    it("should show the no-polygonal-columns line when status is ok and no column was repairable", () => {
      const alerts = render({ status: GeometryRepairStatus.OK, columns: [], skippedColumns: [] });
      expect(alerts).toHaveLength(1);
      expect(alerts[0].type).toBe(AlertType.INFO);
      expect(alerts[0].text).toContain(NO_POLYGONAL_FRAGMENT);
    });

    it("should show one info line per column with its repaired row count", () => {
      expect(
        render({
          status: GeometryRepairStatus.OK,
          columns: [
            { column: "geom", repairedRows: 2, unrepairableRows: 0 },
            { column: "area", repairedRows: 0, unrepairableRows: 0 },
          ],
          skippedColumns: [],
        })
      ).toEqual([
        { type: AlertType.INFO, text: repairedLine("geom", 2) },
        { type: AlertType.INFO, text: repairedLine("area", 0) },
      ]);
    });

    it("should show a single row line for a column with exactly one repaired row", () => {
      expect(
        render({ status: GeometryRepairStatus.OK, columns: [{ column: "geom", repairedRows: 1, unrepairableRows: 0 }], skippedColumns: [] })
      ).toEqual([{ type: AlertType.INFO, text: repairedLine("geom", 1) }]);
    });

    it("should not show the no-polygonal-columns line when at least one column was repaired", () => {
      const texts = render({
        status: GeometryRepairStatus.OK,
        columns: [{ column: "geom", repairedRows: 3, unrepairableRows: 0 }],
        skippedColumns: [],
      }).map((alert) => alert.text);
      expect(texts.some((text) => text.includes(NO_POLYGONAL_FRAGMENT))).toBe(false);
    });

    it("should not show a warning when status is ok and no row is unrepairable", () => {
      const alerts = render({
        status: GeometryRepairStatus.OK,
        columns: [{ column: "geom", repairedRows: 3, unrepairableRows: 0 }],
        skippedColumns: [],
      });
      expect(alerts.some((alert) => alert.type === AlertType.WARNING)).toBe(false);
    });

    it("should show a warning with the unrepairable row count for a column with unrepairable rows", () => {
      const alerts = render({
        status: GeometryRepairStatus.OK,
        columns: [{ column: "geom", repairedRows: 5, unrepairableRows: 3 }],
        skippedColumns: [],
      });
      const warnings = alerts.filter((alert) => alert.type === AlertType.WARNING);
      expect(warnings).toHaveLength(1);
      expect(warnings[0].text).toContain("3 filas no se pudieron reparar y conservan su geometría original");
      expect(warnings[0].text).toContain(UNREPAIRABLE_FRAGMENT);
    });

    it("should show one warning per column that has unrepairable rows and none for the others", () => {
      const alerts = render({
        status: GeometryRepairStatus.OK,
        columns: [
          { column: "geom", repairedRows: 5, unrepairableRows: 2 },
          { column: "area", repairedRows: 1, unrepairableRows: 0 },
          { column: "zed", repairedRows: 0, unrepairableRows: 7 },
        ],
        skippedColumns: [],
      });
      const warnings = alerts.filter((alert) => alert.type === AlertType.WARNING).map((alert) => alert.text);
      expect(warnings).toHaveLength(2);
      expect(warnings[0]).toContain("2 filas");
      expect(warnings[1]).toContain("7 filas");
    });

    it("should show the info line for a skipped polygonal column after the repaired columns", () => {
      expect(
        render({
          status: GeometryRepairStatus.OK,
          columns: [{ column: "geom", repairedRows: 2, unrepairableRows: 0 }],
          skippedColumns: ["poly"],
        })
      ).toEqual([
        { type: AlertType.INFO, text: repairedLine("geom", 2) },
        { type: AlertType.INFO, text: skippedLine("poly") },
      ]);
    });
  });

  describe("repair failed", () => {
    it("should show a warning that the load was kept when status is failed with no columns", () => {
      expect(
        render({ status: GeometryRepairStatus.FAILED, columns: [], skippedColumns: [], message: "columna geom: boom" })
      ).toEqual([{ type: AlertType.WARNING, text: FAILED_TEXT }]);
    });

    it("should show the columns that were repaired before the failure followed by the warning", () => {
      expect(
        render({
          status: GeometryRepairStatus.FAILED,
          columns: [{ column: "geom", repairedRows: 4, unrepairableRows: 0 }],
          skippedColumns: [],
          message: "columna area: denied",
        })
      ).toEqual([
        { type: AlertType.INFO, text: repairedLine("geom", 4) },
        { type: AlertType.WARNING, text: FAILED_TEXT },
      ]);
    });

    it("should show the unrepairable warning for a column repaired before the failure", () => {
      const warnings = render({
        status: GeometryRepairStatus.FAILED,
        columns: [{ column: "geom", repairedRows: 4, unrepairableRows: 2 }],
        skippedColumns: [],
        message: "columna area: denied",
      }).filter((alert) => alert.type === AlertType.WARNING);
      expect(warnings.map((alert) => alert.text)).toEqual([expect.stringContaining(UNREPAIRABLE_FRAGMENT), FAILED_TEXT]);
    });

    it("should still list the skipped polygonal columns when status is failed", () => {
      const texts = render({
        status: GeometryRepairStatus.FAILED,
        columns: [],
        skippedColumns: ["poly"],
        message: "columna geom: boom",
      }).map((alert) => alert.text);
      expect(texts).toContain(skippedLine("poly"));
      expect(texts).toContain(FAILED_TEXT);
    });
  });
});
