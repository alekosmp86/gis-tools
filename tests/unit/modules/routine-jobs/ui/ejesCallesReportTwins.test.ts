import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TWIN_CLASS } from "@/modules/routine-jobs/jobs/ejes-calles/constants";
import type { EjesResult, EjesTwinRow } from "@/modules/routine-jobs/jobs/ejes-calles/types";
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
  },
];

const resultOf = (twins: EjesTwinRow[]): EjesResult =>
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

const render = (twins: EjesTwinRow[]): string =>
  renderToStaticMarkup(React.createElement(EjesCallesReport, { result: resultOf(twins), mapBase: null }));

describe("EjesCallesReport twins (ET-6)", () => {
  it("should show the KPI group Tramos repetidos por localidad with its six cards", () => {
    const html = render(TWINS);

    expect(html).toContain("Tramos repetidos por localidad");
    for (const label of [
      "Total",
      "Cerca de urbanos solamente",
      "Cerca de rurales solamente",
      "Cerca de ambos",
      "Lejos de ambos",
      "En más de un departamento: sin regla",
    ]) {
      expect(html).toContain(label);
    }
  });

  it("should show the collapsible list with the spec columns and a Ver en mapa button per row", () => {
    const html = render(TWINS);

    expect(html).toContain("<details");
    for (const header of ["reftramo", "idcalle", "Departamento", "Localidades", "Caso", "Largo (m)", "Cerca de urbanos (m)", "Cerca de rurales (m)"]) {
      expect(html).toContain(`>${header}</th>`);
    }
    expect(html.match(/aria-label="Ver en mapa"/g)).toHaveLength(2);
  });

  it("should show the cells of a row: localities joined, the case text and the meters with one decimal, sin dato for null", () => {
    const html = render(TWINS);

    expect(html).toContain("1035386");
    expect(html).toContain("FLORES RURAL, TRINIDAD");
    expect(html).toContain("Lejos de padrones: decidir en el mapa");
    expect(html).toContain("250.3");
    expect(html).toContain("Cerca de ambos: se mantienen las dos");
    expect(html).toContain("12.3");
    expect(html).toContain("sin dato");
  });

  it("should show no list, only the KPI group, when there are no twin rows", () => {
    const html = render([]);

    expect(html).toContain("Tramos repetidos por localidad");
    expect(html).not.toContain("Ver en mapa");
    expect(html).not.toContain("Cerca de padrones urbanos");
  });
});
