import { describe, expect, it } from "vitest";
import { buildCompletarUnidadTerritorialCsv } from "@/modules/routine-jobs/ui/reportCsv/completarUnidadTerritorialCsv";
import { reportCsvFilename } from "@/modules/routine-jobs/ui/reportCsv/filename";
import { MonthlyStage } from "@/modules/routine-jobs/ui/monthlyCartoStages";
import { DETAIL_LIST_LIMIT } from "@/modules/routine-jobs/jobs/shared/limits";
import type { CompletarCounts, CompletarLinkedUnit, CompletarResult } from "@/modules/routine-jobs/jobs/completar-unidad-territorial/types";
import { BOM, parseCsv } from "./reportCsvFixtures";
import { ADDRESS_MASTER_LABEL, completarResultOf, linkedUnitOf, UNIT_LABEL } from "../../completar-unidad-territorial/completarFixtures";

const HEADER = ["Tabla", "Cambio", "Provincia", "Nombre", "Id", "Id dirección maestra"];
const CREATED = "Dirección maestra creada";
const LINKED = "Unidad enlazada";
const MARKER_TEXT = (shown: number, total: number): string =>
  `Lista incompleta: se muestran las primeras ${shown} de ${total} unidades enlazadas`;

/** Counts consistent with the list: every listed unit is linked, created ones are new records. */
const countsOf = (linkedList: CompletarLinkedUnit[]): CompletarCounts => ({
  withoutAddressMaster: linkedList.length,
  created: linkedList.filter((unit) => unit.created).length,
  linked: linkedList.length,
  alreadyHadRecord: linkedList.filter((unit) => !unit.created).length,
  ambiguous: 0,
});

const rawCsvOf = (linkedList: CompletarLinkedUnit[], overrides: Partial<CompletarResult> = {}): string =>
  buildCompletarUnidadTerritorialCsv(completarResultOf({ linkedList, counts: countsOf(linkedList), ...overrides }));

const rowsOf = (linkedList: CompletarLinkedUnit[], overrides: Partial<CompletarResult> = {}): string[][] =>
  parseCsv(rawCsvOf(linkedList, overrides));

const dataRowsOf = (linkedList: CompletarLinkedUnit[], overrides: Partial<CompletarResult> = {}): string[][] =>
  rowsOf(linkedList, overrides).slice(1);

const unitsOf = (count: number, overrides: Partial<CompletarLinkedUnit> = {}): CompletarLinkedUnit[] =>
  Array.from({ length: count }, (_, index) => linkedUnitOf({ id: 1000 + index, addressMasterId: 2000 + index, created: false, ...overrides }));

describe("buildCompletarUnidadTerritorialCsv", () => {
  describe("envelope", () => {
    it("should start with the UTF-8 BOM", () => {
      expect(rawCsvOf([linkedUnitOf()]).startsWith(BOM)).toBe(true);
    });

    it("should write the change header as the first row", () => {
      expect(rowsOf([linkedUnitOf()])[0]).toEqual(HEADER);
    });

    it("should write only the header when no unit was linked", () => {
      expect(rowsOf([])).toEqual([HEADER]);
    });
  });

  describe("created address master records", () => {
    it("should write one created row per new record in the address master table with the unit id and the new record id", () => {
      const rows = dataRowsOf([linkedUnitOf({ id: 101, name: "Unidad uno", provinceId: "02", addressMasterId: 501, created: true })]);

      expect(rows).toContainEqual([ADDRESS_MASTER_LABEL, CREATED, "02", "Unidad uno", "101", "501"]);
    });

    it("should write no created row for a unit that already had a record", () => {
      const rows = dataRowsOf([linkedUnitOf({ created: false })]);

      expect(rows.some((row) => row[1] === CREATED)).toBe(false);
    });

    it("should write the created rows before the linked rows", () => {
      const rows = dataRowsOf([
        linkedUnitOf({ id: 1, created: false }),
        linkedUnitOf({ id: 2, created: true }),
        linkedUnitOf({ id: 3, created: true }),
      ]);

      expect(rows.map((row) => row[1])).toEqual([CREATED, CREATED, LINKED, LINKED, LINKED]);
      expect(rows.slice(0, 2).map((row) => row[4])).toEqual(["2", "3"]);
    });
  });

  describe("linked units", () => {
    it("should write one linked row per linked unit in the unit table with its record id", () => {
      const rows = dataRowsOf([linkedUnitOf({ id: 102, name: "Unidad dos", provinceId: "10", addressMasterId: 17, created: false })]);

      expect(rows).toEqual([[UNIT_LABEL, LINKED, "10", "Unidad dos", "102", "17"]]);
    });

    it("should write a linked row for an existing record too, so every linked unit appears", () => {
      const rows = dataRowsOf(unitsOf(3));

      expect(rows.filter((row) => row[1] === LINKED)).toHaveLength(3);
    });

    it("should write every linked unit without truncating past the UI sample limit of 20", () => {
      expect(dataRowsOf(unitsOf(25)).filter((row) => row[1] === LINKED)).toHaveLength(25);
    });

    it("should write no list-cut marker when the linked count equals the listed units", () => {
      const rows = dataRowsOf(unitsOf(3));

      expect(rows.some((row) => row[1].startsWith("Lista incompleta"))).toBe(false);
    });
  });

  describe("missing data and hostile text", () => {
    it("should write sin dato for a missing name and a missing province", () => {
      const rows = dataRowsOf([linkedUnitOf({ name: null, provinceId: null, created: false })]);

      expect(rows[0]).toEqual([UNIT_LABEL, LINKED, "sin dato", "sin dato", "101", "501"]);
    });

    it("should neutralize a formula trigger in a unit name", () => {
      const rows = dataRowsOf([linkedUnitOf({ name: "=SUMA(A1)", created: false })]);

      expect(rows[0][3]).toBe("'=SUMA(A1)");
    });

    it("should keep a name with a comma and quotes inside one cell", () => {
      const rows = dataRowsOf([linkedUnitOf({ name: 'Unidad "Norte", sur', created: false })]);

      expect(rows[0][3]).toBe('Unidad "Norte", sur');
    });
  });

  describe("content restrictions", () => {
    it("should write the same rows in a dry run", () => {
      const units = [linkedUnitOf({ created: true }), linkedUnitOf({ id: 2, created: false })];

      expect(dataRowsOf(units, { dryRun: true })).toEqual(dataRowsOf(units, { dryRun: false }));
    });

    it("should write no counts, warnings, timings or banners", () => {
      const csv = rawCsvOf([linkedUnitOf()], { warnings: ["Advertencia de prueba"] });

      for (const text of ["Advertencia", "Informe", "Unidades sin dirección", "Ya tenían registro", "Ambiguas"]) {
        expect(csv).not.toContain(text);
      }
    });
  });

  describe("completeness of the database changes (CU-16)", () => {
    it("should write the listed linked rows and one closing marker row when more units were linked than listed", () => {
      const linkedCount = DETAIL_LIST_LIMIT + 100;
      const listed = unitsOf(DETAIL_LIST_LIMIT);

      const rows = dataRowsOf(listed, {
        counts: {
          withoutAddressMaster: linkedCount,
          created: 0,
          linked: linkedCount,
          alreadyHadRecord: linkedCount,
          ambiguous: 0,
        },
      });

      const linkedRows = rows.filter((row) => row[1] === LINKED);
      expect(linkedRows).toHaveLength(DETAIL_LIST_LIMIT);
      expect(rows.at(-1)).toEqual([UNIT_LABEL, MARKER_TEXT(DETAIL_LIST_LIMIT, linkedCount), "", "", "", ""]);
    });

    it("should write the marker after every change row so the cut is the last line of the file", () => {
      const rows = dataRowsOf(unitsOf(2), {
        counts: { withoutAddressMaster: 5, created: 0, linked: 5, alreadyHadRecord: 5, ambiguous: 0 },
      });

      expect(rows).toHaveLength(3);
      expect(rows[2][1]).toBe(MARKER_TEXT(2, 5));
    });
  });
});

describe("completar CSV cut markers for created records and linked units (CU-16)", () => {
  const CREATED_NOUN = "direcciones maestras creadas";
  const createdMarker = (shown: number, total: number): string =>
    `Lista incompleta: se muestran las primeras ${shown} de ${total} ${CREATED_NOUN}`;

  const createdUnits = (count: number): CompletarLinkedUnit[] =>
    Array.from({ length: count }, (_, index) => linkedUnitOf({ id: 1 + index, addressMasterId: 5000 + index, created: true }));

  const eightHundredCreated = () => {
    const listed = createdUnits(DETAIL_LIST_LIMIT);
    return completarResultOf({
      linkedList: listed,
      counts: { withoutAddressMaster: 800, created: 800, linked: 800, alreadyHadRecord: 0, ambiguous: 0 },
    });
  };

  it("should write the 500 listed created rows and a created marker naming the total of 800", () => {
    const rows = parseCsv(buildCompletarUnidadTerritorialCsv(eightHundredCreated())).slice(1);

    expect(rows.filter((row) => row[1] === CREATED)).toHaveLength(DETAIL_LIST_LIMIT);
    expect(rows).toContainEqual([ADDRESS_MASTER_LABEL, createdMarker(DETAIL_LIST_LIMIT, 800), "", "", "", ""]);
  });

  it("should write a linked marker naming the total of 800 alongside the created marker", () => {
    const rows = parseCsv(buildCompletarUnidadTerritorialCsv(eightHundredCreated())).slice(1);

    expect(rows).toContainEqual([
      UNIT_LABEL,
      `Lista incompleta: se muestran las primeras ${DETAIL_LIST_LIMIT} de 800 unidades enlazadas`,
      "",
      "",
      "",
      "",
    ]);
  });

  it("should write no created marker when the created count equals the listed created units", () => {
    const result = completarResultOf({
      linkedList: createdUnits(3),
      counts: { withoutAddressMaster: 3, created: 3, linked: 3, alreadyHadRecord: 0, ambiguous: 0 },
    });

    const rows = parseCsv(buildCompletarUnidadTerritorialCsv(result));

    expect(rows.some((row) => row[1] === createdMarker(3, 3))).toBe(false);
  });

  it("should print the shown created count, not the list limit, in the created and linked markers when they differ", () => {
    const created = createdUnits(200);
    const existing = Array.from({ length: 300 }, (_, index) =>
      linkedUnitOf({ id: 5000 + index, addressMasterId: 9000 + index, created: false }),
    );
    const result = completarResultOf({
      linkedList: [...created, ...existing],
      counts: { withoutAddressMaster: 800, created: 300, linked: 800, alreadyHadRecord: 500, ambiguous: 0 },
    });

    const rows = parseCsv(buildCompletarUnidadTerritorialCsv(result)).slice(1);

    expect(rows).toContainEqual([ADDRESS_MASTER_LABEL, createdMarker(200, 300), "", "", "", ""]);
    expect(rows).toContainEqual([
      UNIT_LABEL,
      `Lista incompleta: se muestran las primeras ${DETAIL_LIST_LIMIT} de 800 unidades enlazadas`,
      "",
      "",
      "",
      "",
    ]);
  });

  it("should give the created marker the address master table, not the unit table", () => {
    const markers = parseCsv(buildCompletarUnidadTerritorialCsv(eightHundredCreated())).filter((row) =>
      row[1].includes(CREATED_NOUN),
    );

    expect(markers.map((row) => row[0])).toEqual([ADDRESS_MASTER_LABEL]);
  });
});

describe("completar CSV filename (CU-16)", () => {
  const generatedAt = new Date(2026, 9, 28, 14, 5, 9);

  it("should name a real run file with the completar-unidad-territorial stage slug", () => {
    expect(reportCsvFilename(MonthlyStage.COMPLETAR_UNIDAD_TERRITORIAL, false, generatedAt)).toBe(
      "carto-completar-unidad-territorial-real-20261028-140509.csv",
    );
  });

  it("should name a dry run file with the simulacion segment and the same stage slug", () => {
    expect(reportCsvFilename(MonthlyStage.COMPLETAR_UNIDAD_TERRITORIAL, true, generatedAt)).toBe(
      "carto-completar-unidad-territorial-simulacion-20261028-140509.csv",
    );
  });
});
