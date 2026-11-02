import { describe, expect, it } from "vitest";
import { REPLACEMENT_CLASS } from "@/modules/routine-jobs/jobs/actualizar-padron/constants";
import type { ActualizarTargetReport, MissingPadron } from "@/modules/routine-jobs/jobs/actualizar-padron/types";
import { buildRemovalMarksCsv } from "@/modules/routine-jobs/ui/reportCsv/missingPadronCsv";

const BOM = "﻿";
const HEADER = "Id actual,Tipo,Departamento,Localidad,Padrón,Clase,Cubierto (%),Reemplazado por,Referencias,Latitud,Longitud";

const missingPadronOf = (overrides: Partial<MissingPadron> = {}): MissingPadron => ({
  oldId: 500,
  typePadron: "URBANO",
  provinceId: 6,
  department: "MONTEVIDEO",
  locality: "CENTRO",
  number: "200",
  oldAreaM2: 10000,
  centroidLat: -34.906123,
  centroidLon: -56.164531,
  class: REPLACEMENT_CLASS.REPLACED_ONE,
  coveredPct: 95,
  parts: ["URBANO 201 (95.0 %)"],
  ...overrides,
});

const targetOf = (missingReview: MissingPadron[]): ActualizarTargetReport => ({
  table: "carto.padron_tmp_actualizacion",
  schema: "carto",
  inserted: 0,
  insertedList: [],
  updated: 0,
  updateApplied: false,
  unchanged: 0,
  unchangedWithinTolerance: 0,
  changed: 0,
  missing: missingReview.length,
  missingSamples: [],
  missingByClass: { REPLACED_ONE: missingReview.length, SUBDIVIDED: 0, PARTIAL: 0, ORPHAN: 0 },
  missingReview,
  ambiguous: 0,
  ambiguousSamples: [],
  geometryChanges: [],
  geometryPending: 0,
  pairs: [],
  pairsTotal: 0,
  pairsApplied: 0,
  pairsLoose: 0,
  pairsPending: 0,
  pairsNotApplied: 0,
  choicesUnapplied: 0,
});

const ROW_500 = "500,URBANO,MONTEVIDEO,CENTRO,200,Reemplazado,95,URBANO 201 (95.0 %),sin dato,-34.906123,-56.164531";
const ROW_600 = "600,RURAL,MONTEVIDEO,sin dato,300,Huérfano,0,sin dato,puntos de acceso: 2,-34.5,-56.1";

describe("buildRemovalMarksCsv", () => {
  it("should write the BOM, the removal header and one row for each marked padron, with the exact cells", () => {
    const csv = buildRemovalMarksCsv(targetOf([missingPadronOf()]), [500]);

    expect(csv).toBe(`${BOM}${HEADER}\r\n${ROW_500}`);
  });

  it("should write only the header when no padron is marked", () => {
    const csv = buildRemovalMarksCsv(targetOf([missingPadronOf()]), []);

    expect(csv).toBe(`${BOM}${HEADER}`);
  });

  it("should write only the header when the marked ids are not in the listed review", () => {
    const csv = buildRemovalMarksCsv(targetOf([missingPadronOf()]), [999]);

    expect(csv).toBe(`${BOM}${HEADER}`);
  });

  it("should write the marked rows in report order, not in the order of the marks", () => {
    const target = targetOf([
      missingPadronOf({ oldId: 500 }),
      missingPadronOf({ oldId: 600, typePadron: "RURAL", locality: null, class: REPLACEMENT_CLASS.ORPHAN, coveredPct: 0, parts: [], refs: { accessPoint: 2 }, centroidLat: -34.5, centroidLon: -56.1, number: "300" }),
    ]);

    const csv = buildRemovalMarksCsv(target, [600, 500]);

    expect(csv).toBe(`${BOM}${HEADER}\r\n${ROW_500}\r\n${ROW_600}`);
  });

  it("should leave an unmarked padron out even when it is listed", () => {
    const csv = buildRemovalMarksCsv(targetOf([missingPadronOf({ oldId: 500 }), missingPadronOf({ oldId: 600 })]), [500]);

    expect(csv).not.toContain("\r\n600,");
    expect(csv.split("\r\n")).toHaveLength(2);
  });

  it("should leave a negative coordinate unguarded because it is a number, not text", () => {
    const csv = buildRemovalMarksCsv(targetOf([missingPadronOf()]), [500]);

    expect(csv).toContain(",-34.906123,-56.164531");
    expect(csv).not.toContain("'-34");
  });

  it.each(["=", "+", "-", "@"])("should prefix a text cell that starts with %s with a quote, so a spreadsheet reads it as text", (trigger) => {
    const csv = buildRemovalMarksCsv(targetOf([missingPadronOf({ locality: `${trigger}CALC` })]), [500]);

    expect(csv).toContain(`MONTEVIDEO,'${trigger}CALC,200,`);
  });

  it("should quote a text cell that holds a comma and double its inner quotes", () => {
    const csv = buildRemovalMarksCsv(targetOf([missingPadronOf({ department: 'Dpto, "Norte"' })]), [500]);

    expect(csv).toContain(`,"Dpto, ""Norte""",CENTRO,`);
  });
});
