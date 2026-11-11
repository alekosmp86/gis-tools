import { describe, expect, it } from "vitest";
import { ejesBlockersOf } from "@/modules/routine-jobs/jobs/ejes-calles/domain/blockers";
import type { EjesStagingReport } from "@/modules/routine-jobs/jobs/ejes-calles/types";

const cleanStaging = (overrides: Partial<EjesStagingReport> = {}): EjesStagingReport => ({
  rows: 100,
  distinctRefs: 100,
  repeatedGroups: 0,
  repeatedRows: 0,
  nonIntegerRefs: 0,
  emptyGeometry: 0,
  emptyIdcalle: 0,
  damagedTextRows: 0,
  unknownTipoRows: 0,
  unknownFuenteRows: 0,
  unknownTipos: [],
  unknownFuentes: [],
  ...overrides,
});

describe("ejesBlockersOf (EJ-8)", () => {
  it("should return no blockers for clean staging data", () => {
    expect(ejesBlockersOf(cleanStaging())).toEqual([]);
  });

  it("should not treat plain counts (rows, distinct refs) as blockers", () => {
    expect(ejesBlockersOf(cleanStaging({ rows: 0, distinctRefs: 0 }))).toEqual([]);
  });

  it("should block on repeated reftramo with groups and rows", () => {
    expect(ejesBlockersOf(cleanStaging({ repeatedGroups: 2, repeatedRows: 5 }))).toEqual([
      "2 reftramo se repiten (5 filas).",
    ]);
  });

  it("should use the singular form for one group and one row", () => {
    expect(ejesBlockersOf(cleanStaging({ repeatedGroups: 1, repeatedRows: 1 }))[0]).toContain(
      "1 reftramo se repite (1 fila)"
    );
  });

  it("should block on non-integer reftramo", () => {
    expect(ejesBlockersOf(cleanStaging({ nonIntegerRefs: 3 }))).toEqual([
      "3 filas tienen un reftramo que no es un entero.",
    ]);
  });

  it("should block on null or empty geometry", () => {
    expect(ejesBlockersOf(cleanStaging({ emptyGeometry: 1 }))).toEqual(["1 fila tiene la geometría nula o vacía."]);
  });

  it("should block on empty idcalle", () => {
    expect(ejesBlockersOf(cleanStaging({ emptyIdcalle: 4 }))).toEqual(["4 filas tienen el idcalle vacío."]);
  });

  it("should block on rows with damaged characters in nombre, localidad or departamento", () => {
    expect(ejesBlockersOf(cleanStaging({ damagedTextRows: 7 }))).toEqual([
      "Hay 7 filas con caracteres dañados (�) en nombre, localidad o departamento. Corrija la codificación y vuelva a cargar.",
    ]);
  });

  it("should block on unknown tipo_vialidad listing each value with its row count", () => {
    const blockers = ejesBlockersOf(
      cleanStaging({
        unknownTipoRows: 4,
        unknownTipos: [
          { value: "AUTOPISTA", rows: 3 },
          { value: null, rows: 1 },
        ],
      })
    );

    expect(blockers).toEqual(["Tipo de vialidad fuera de la tabla de tipos: AUTOPISTA (3 filas), sin dato (1 fila)."]);
  });

  it("should block on unknown fuente listing the value and rows", () => {
    const blockers = ejesBlockersOf(cleanStaging({ unknownFuenteRows: 2, unknownFuentes: [{ value: "XYZ", rows: 2 }] }));

    expect(blockers).toEqual(["Fuente fuera de la tabla de fuentes: XYZ (2 filas)."]);
  });

  it("should report every blocker when all checks fail", () => {
    const blockers = ejesBlockersOf(
      cleanStaging({
        repeatedGroups: 1,
        repeatedRows: 2,
        nonIntegerRefs: 1,
        emptyGeometry: 1,
        emptyIdcalle: 1,
        damagedTextRows: 1,
        unknownTipoRows: 1,
        unknownTipos: [{ value: "X", rows: 1 }],
        unknownFuenteRows: 1,
        unknownFuentes: [{ value: "Y", rows: 1 }],
      })
    );

    expect(blockers).toHaveLength(7);
  });
});
