import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TWIN_CLASS } from "@/modules/routine-jobs/jobs/ejes-calles/constants";
import type { EjesInvalidGeometryRow, EjesResult, EjesTwinRow } from "@/modules/routine-jobs/jobs/ejes-calles/types";
import { EjesCallesReport } from "@/modules/routine-jobs/ui/EjesCallesReport";

const COUNTS = {
  newSections: 0,
  unchanged: 0,
  attr: 0,
  geom: 0,
  both: 0,
  removed: 0,
  splits: 0,
  merges: 0,
  plainRemovals: 0,
  plainHeld: 0,
  newStreets: 0,
  twins: 2,
  twinsUrban: 0,
  twinsRural: 0,
  twinsBoth: 1,
  twinsNeither: 1,
  twinsCrossDepartment: 7,
  twinsDrop: 1,
  twinsKeep: 1,
};

const TWINS: EjesTwinRow[] = [
  {
    ref: "1035386",
    idcalle: "72006",
    department: "FLORES",
    localities: ["FLORES RURAL", "TRINIDAD"],
    class: TWIN_CLASS.NEITHER,
    length: 250.25,
    urbanLength: 0,
    ruralLength: null,
    dropLocalities: [],
  },
  {
    ref: "1035390",
    idcalle: null,
    department: null,
    localities: ["A", "B"],
    class: TWIN_CLASS.BOTH,
    length: 99.94,
    urbanLength: 40,
    ruralLength: 12.34,
    dropLocalities: [],
  },
];

const resultOf = (twins: EjesTwinRow[], invalid: EjesInvalidGeometryRow[] = []): EjesResult =>
  ({
    dryRun: true,
    targetModified: false,
    outcomeUnknown: false,
    staging: {
      rows: 0,
      distinctRefs: 0,
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
      invalidGeometryRows: invalid.length,
      invalidGeometryRefs: new Set(invalid.map((row) => row.ref)).size,
      invalidGeometries: invalid,
    },
    counts: { ...COUNTS, twins: twins.length },
    cloc: { withLocality: 0, onlyDepartment: 0, withoutCode: 0 },
    splits: [],
    merges: [],
    plainRemovals: [],
    newStreets: [],
    attrChanges: [],
    twins,
    blockers: [],
    privilegeInfo: [],
    tables: {},
    stepTimings: [],
  }) as unknown as EjesResult;

const render = (twins: EjesTwinRow[], invalid: EjesInvalidGeometryRow[] = []): string =>
  renderToStaticMarkup(React.createElement(EjesCallesReport, { result: resultOf(twins, invalid), mapBase: null }));

describe("EjesCallesReport invalid geometries (ET-18)", () => {
  const INVALID: EjesInvalidGeometryRow[] = [
    { ref: "1001", idcalle: "72006", localidad: "TRINIDAD", departamento: "FLORES" },
    { ref: "1002", idcalle: null, localidad: null, departamento: null },
  ];

  it("should show a collapsible list titled Tramos con geometría inválida (se omiten) with the four columns and the rows", () => {
    const html = render([], INVALID);

    expect(html).toContain("Tramos con geometría inválida (se omiten)");
    for (const header of ["reftramo", "idcalle", "Localidad", "Departamento"]) {
      expect(html).toContain(`>${header}</th>`);
    }
    expect(html).toContain("1001");
    expect(html).toContain("TRINIDAD");
    expect(html).toContain("FLORES");
    expect(html).toContain("sin dato");
  });

  it("should offer no map button for the invalid rows", () => {
    expect(render([], INVALID)).not.toContain("Ver en mapa");
  });

  it("should show the two KPIs of the file problems", () => {
    const html = render([], INVALID);

    expect(html).toContain("Filas con geometría inválida (se omiten)");
    expect(html).toContain("Tramos con geometría inválida");
  });

  it("should hide the list and the KPIs when there are none", () => {
    const html = render([], []);

    expect(html).not.toContain("Tramos con geometría inválida");
    expect(html).not.toContain("Filas con geometría inválida");
  });
});

describe("EjesCallesReport twins (ET-6)", () => {
  it("should show the KPI group Tramos repetidos por localidad with its eight cards", () => {
    const html = render(TWINS);

    expect(html).toContain("Tramos repetidos por localidad");
    for (const label of [
      "Total",
      "Cerca de urbanos solamente",
      "Cerca de rurales solamente",
      "Cerca de ambos",
      "Lejos de ambos",
      "Se quitaría alguna copia",
      "Se mantienen todas",
      "En más de un departamento: sin regla",
    ]) {
      expect(html).toContain(label);
    }
  });

  it("should show the collapsible list with the spec columns and a Ver en mapa button per row", () => {
    const html = render(TWINS);

    expect(html).toContain("<details");
    for (const header of ["reftramo", "idcalle", "Departamento", "Localidades", "Caso", "Largo (m)", "Cerca de urbanos (m)", "Cerca de rurales (m)", "Qué pasa"]) {
      expect(html).toContain(`>${header}</th>`);
    }
    expect(html.match(/aria-label="Ver en mapa"/g)).toHaveLength(2);
  });

  it("should show the cells of a row: localities joined, the case text and the meters with one decimal, sin dato for null", () => {
    const html = render(TWINS);

    expect(html).toContain("1035386");
    expect(html).toContain("FLORES RURAL, TRINIDAD");
    expect(html).toContain("Lejos de padrones: sin regla");
    expect(html).toContain("250.3");
    expect(html).toContain("Cerca de ambos: se mantienen las dos");
    expect(html).toContain("12.3");
    expect(html).toContain("sin dato");
  });

  it("should show the decision of each row in the Qué pasa column", () => {
    const urban: EjesTwinRow = {
      ...TWINS[0],
      ref: "1035400",
      class: TWIN_CLASS.URBAN,
      localities: ["TRINIDAD", "FLORES RURAL"],
      dropLocalities: ["FLORES RURAL"],
    };
    const rural: EjesTwinRow = {
      ...TWINS[0],
      ref: "1035401",
      class: TWIN_CLASS.RURAL,
      localities: ["A RURAL", "B RURAL", "TRINIDAD"],
      dropLocalities: ["TRINIDAD", "B RURAL"],
    };
    const html = render([urban, rural, ...TWINS]);

    expect(html).toContain("Se quitaría: FLORES RURAL");
    expect(html).toContain("Se quitaría: TRINIDAD, B RURAL");
    expect(html).toContain("Sin regla: se mantienen todas");
    expect(html).toContain("Se mantienen todas");
  });

  it("should show no list, only the KPI group, when there are no twin rows", () => {
    const html = render([]);

    expect(html).toContain("Tramos repetidos por localidad");
    expect(html).not.toContain("Ver en mapa");
    expect(html).not.toContain("Cerca de padrones urbanos");
  });
});
