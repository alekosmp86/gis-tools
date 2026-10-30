import { describe, expect, it } from "vitest";
import { buildCargarLocalidadesCsv } from "@/modules/routine-jobs/ui/reportCsv/cargarLocalidadesCsv";
import { buildUnidadTerritorialCsv } from "@/modules/routine-jobs/ui/reportCsv/unidadTerritorialCsv";
import { changeCsvOf, cutRowsOf, type ListCut } from "@/modules/routine-jobs/ui/reportCsv/reportCsvRows";
import { DETAIL_LIST_LIMIT } from "@/modules/routine-jobs/jobs/shared/limits";
import {
  BOM,
  cargarLocalidadesResultOf,
  parseCsv,
  targetReportOf,
  unitResultOf,
  unitTargetReportOf,
} from "./reportCsvFixtures";

const STAGE2_WIDTH = 7;
const STAGE3_WIDTH = 8;
const LOCALITY_TABLE = "localidades_norte";
const UNIT_TABLE = "unidades_destino";
const EMPTY_CELLS = (width: number): string[] => Array.from({ length: width - 2 }, () => "");

const markerOf = (shown: number, total: number, noun: string): string =>
  `Lista incompleta: se muestran las primeras ${shown} de ${total} ${noun}`;

const insertedLocalities = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ department: "CORDOBA", name: `Localidad ${index}`, id: 9000 + index }));

const geometryChanges = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ department: "JUJUY", name: `Geometría ${index}`, distance: 1.5, areaRatio: 1 }));

const unitInserted = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ provinceId: "02", name: `Unidad ${index}`, id: 7000 + index }));

const unitGeometry = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ provinceId: "03", name: `Geom unidad ${index}`, distance: 2, areaRatio: 1.1 }));

const stage2Rows = (targets: ReturnType<typeof targetReportOf>[]): string[][] =>
  parseCsv(buildCargarLocalidadesCsv(cargarLocalidadesResultOf({ targets })));

const stage3Rows = (overrides: Parameters<typeof unitTargetReportOf>[0]): string[][] =>
  parseCsv(buildUnidadTerritorialCsv(unitResultOf({ target: unitTargetReportOf(overrides) })));

const markerRowsOf = (rows: string[][]): string[][] => rows.filter((row) => row[1]?.startsWith("Lista incompleta"));

describe("list cut markers for stage 2 (cargar localidades)", () => {
  it("should close the inserted localities with a marker naming the table, the shown and total counts", () => {
    const rows = stage2Rows([
      targetReportOf(LOCALITY_TABLE, {
        inserted: 600,
        insertedList: insertedLocalities(DETAIL_LIST_LIMIT),
      }),
    ]);

    expect(markerRowsOf(rows)).toEqual([
      [LOCALITY_TABLE, markerOf(DETAIL_LIST_LIMIT, 600, "localidades insertadas"), ...EMPTY_CELLS(STAGE2_WIDTH)],
    ]);
  });

  it("should close the geometry changes with a marker naming the changed count", () => {
    const rows = stage2Rows([
      targetReportOf(LOCALITY_TABLE, {
        changed: 700,
        geometryChanges: geometryChanges(DETAIL_LIST_LIMIT),
      }),
    ]);

    expect(markerRowsOf(rows)).toEqual([
      [LOCALITY_TABLE, markerOf(DETAIL_LIST_LIMIT, 700, "geometrías que cambian"), ...EMPTY_CELLS(STAGE2_WIDTH)],
    ]);
  });

  it("should write one inserted marker and one geometry marker per target that was cut", () => {
    const rows = stage2Rows([
      targetReportOf("localidades_norte", { inserted: 600, insertedList: insertedLocalities(DETAIL_LIST_LIMIT) }),
      targetReportOf("localidades_sur", { changed: 900, geometryChanges: geometryChanges(DETAIL_LIST_LIMIT) }),
    ]);

    const markers = markerRowsOf(rows);
    expect(markers.map((row) => row[0])).toEqual(["localidades_norte", "localidades_sur"]);
    expect(markers.map((row) => row[1])).toEqual([
      markerOf(DETAIL_LIST_LIMIT, 600, "localidades insertadas"),
      markerOf(DETAIL_LIST_LIMIT, 900, "geometrías que cambian"),
    ]);
  });

  it("should write no marker when the counts equal the list lengths", () => {
    const rows = stage2Rows([
      targetReportOf(LOCALITY_TABLE, {
        inserted: 25,
        insertedList: insertedLocalities(25),
        changed: 25,
        geometryChanges: geometryChanges(25),
      }),
    ]);

    expect(markerRowsOf(rows)).toEqual([]);
  });

  it("should write no marker for the default fixture whose lists hold every counted change", () => {
    const rows = parseCsv(buildCargarLocalidadesCsv(cargarLocalidadesResultOf()));

    expect(markerRowsOf(rows)).toEqual([]);
  });

  it("should write a marker at 501 inserted against 500 listed and none at exactly 500 against 500", () => {
    const atLimit = markerRowsOf(stage2Rows([targetReportOf(LOCALITY_TABLE, { inserted: DETAIL_LIST_LIMIT, insertedList: insertedLocalities(DETAIL_LIST_LIMIT) })]));
    const aboveLimit = markerRowsOf(stage2Rows([targetReportOf(LOCALITY_TABLE, { inserted: DETAIL_LIST_LIMIT + 1, insertedList: insertedLocalities(DETAIL_LIST_LIMIT) })]));

    expect(atLimit).toEqual([]);
    expect(aboveLimit).toHaveLength(1);
    expect(aboveLimit[0][1]).toBe(markerOf(DETAIL_LIST_LIMIT, DETAIL_LIST_LIMIT + 1, "localidades insertadas"));
  });
});

describe("list cut markers for stage 3 (unidad territorial)", () => {
  it("should close the inserted units with a marker naming the table and the counts", () => {
    const rows = stage3Rows({ inserted: 600, insertedList: unitInserted(DETAIL_LIST_LIMIT), changed: 0, geometryChanges: [] });

    expect(markerRowsOf(rows)).toEqual([
      [UNIT_TABLE, markerOf(DETAIL_LIST_LIMIT, 600, "unidades insertadas"), ...EMPTY_CELLS(STAGE3_WIDTH)],
    ]);
  });

  it("should close the geometry changes with a marker naming the changed count", () => {
    const rows = stage3Rows({ inserted: 0, insertedList: [], changed: 700, geometryChanges: unitGeometry(DETAIL_LIST_LIMIT) });

    expect(markerRowsOf(rows)).toEqual([
      [UNIT_TABLE, markerOf(DETAIL_LIST_LIMIT, 700, "geometrías que cambian"), ...EMPTY_CELLS(STAGE3_WIDTH)],
    ]);
  });

  it("should write both markers after the change rows when both lists were cut", () => {
    const rows = stage3Rows({
      inserted: 600,
      insertedList: unitInserted(DETAIL_LIST_LIMIT),
      changed: 700,
      geometryChanges: unitGeometry(DETAIL_LIST_LIMIT),
    });

    expect(markerRowsOf(rows).map((row) => row[1])).toEqual([
      markerOf(DETAIL_LIST_LIMIT, 600, "unidades insertadas"),
      markerOf(DETAIL_LIST_LIMIT, 700, "geometrías que cambian"),
    ]);
    expect(rows.at(-1)?.[1]).toBe(markerOf(DETAIL_LIST_LIMIT, 700, "geometrías que cambian"));
  });

  it("should still mark the geometry cut when the geometry was not applied", () => {
    const rows = stage3Rows({
      updateApplied: false,
      inserted: 0,
      insertedList: [],
      changed: 700,
      geometryChanges: unitGeometry(DETAIL_LIST_LIMIT),
    });

    expect(markerRowsOf(rows)).toHaveLength(1);
  });

  it("should write no marker when the counts equal the list lengths", () => {
    expect(markerRowsOf(stage3Rows({}))).toEqual([]);
  });
});

describe("cutRowsOf and changeCsvOf", () => {
  it("should write no row for a list whose total does not exceed the shown count", () => {
    const cuts: ListCut[] = [
      { table: "t", shown: 3, total: 3, noun: "filas" },
      { table: "t", shown: 3, total: 2, noun: "filas" },
    ];

    expect(cutRowsOf(cuts, STAGE3_WIDTH)).toEqual([]);
  });

  it("should write a marker row as wide as the header it closes", () => {
    const csv = changeCsvOf([], [{ table: "t", shown: 1, total: 2, noun: "filas" }]);
    const rows = parseCsv(csv);

    expect(rows[1]).toHaveLength(STAGE2_WIDTH);
    expect(rows[1][1]).toBe(markerOf(1, 2, "filas"));
  });

  it("should write the marker text unquoted, since it holds no comma, quote or line break", () => {
    const marker = markerOf(1, 2, "filas");
    const csv = changeCsvOf([], [{ table: "t", shown: 1, total: 2, noun: "filas" }]);

    expect(csv).toContain(`\r\nt,${marker},`);
    expect(csv.startsWith(BOM)).toBe(true);
  });

  it("should pass the table cell of a marker through the formula guard like any text cell", () => {
    const rows = parseCsv(changeCsvOf([], [{ table: "=tabla", shown: 1, total: 2, noun: "filas" }]));

    expect(rows[1][0]).toBe("'=tabla");
    expect(rows[1][1]).toBe(markerOf(1, 2, "filas"));
  });
});
