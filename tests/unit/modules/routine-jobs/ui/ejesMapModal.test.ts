import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { EjesMergeRow, EjesSplitRow, EjesTwinRow } from "@/modules/routine-jobs/jobs/ejes-calles/types";
import type { EjesGeometryMapBase } from "@/modules/routine-jobs/ui/clientTypes";
import { EjesMapDetails } from "@/modules/routine-jobs/ui/EjesMapDetails";
import { EJES_CONNECTION_NOTICE, EjesMapModal } from "@/modules/routine-jobs/ui/EjesMapModal";
import { subjectOfMerge, subjectOfSplit, subjectOfTwin } from "@/modules/routine-jobs/ui/ejesMapSubject";

const SPLIT: EjesSplitRow = {
  oldRef: "1001634",
  idcalle: "72006",
  newRefs: ["1035386", "1035390"],
  points: 1,
  coverage: 1,
  oldLength: 1087.76,
  newLength: 1120.5,
  outsideLength: 32.74,
};

const MERGE: EjesMergeRow = {
  newRef: "1022112",
  idcalle: "63837",
  oldRefs: ["947815", "947816"],
  points: 0,
  coverage: 0.98,
  oldLength: 80,
  newLength: 80,
  outsideLength: 0,
};

const TWIN: EjesTwinRow = {
  ref: "1035386",
  idcalle: "72006",
  department: "FLORES",
  localities: ["FLORES RURAL", "TRINIDAD"],
  class: "BOTH",
  length: 250.25,
  urbanLength: 120.5,
  ruralLength: 30,
  dropLocalities: [],
};

const BASE: EjesGeometryMapBase = {
  connection: { host: "db.local", port: "5432", db_name: "gis", user: "gis_user", password: "pw" },
  tables: {
    "ejes-origen": { schema: "bdj_carto", table: "ide_ejesviacirculacion" },
    "ejes-tramos": { schema: "carto", table: "road_section" },
    "ejes-padrones": { schema: "carto", table: "padron" },
  },
};

const NOOP = (): void => undefined;

const renderModal = (props: Partial<React.ComponentProps<typeof EjesMapModal>> = {}): string =>
  renderToStaticMarkup(
    React.createElement(EjesMapModal, {
      review: { subjects: [subjectOfSplit(SPLIT), subjectOfMerge(MERGE)], index: 0 },
      base: BASE,
      onNavigate: NOOP,
      onClose: NOOP,
      ...props,
    })
  );

describe("EjesMapDetails (EM-12, EM-14)", () => {
  const subject = subjectOfSplit(SPLIT);

  it("should show the facts of the row before any outline is selected, with the hint to click one", () => {
    const html = renderToStaticMarkup(React.createElement(EjesMapDetails, { subject, outline: null }));

    expect(html).toContain("72006");
    expect(html).toContain("Puntos de acceso");
    expect(html).toContain("100%");
    expect(html).toContain("1087.8");
    expect(html).toContain("1120.5");
    expect(html).toContain("32.7");
    expect(html).toContain("Haga clic en un tramo del mapa");
  });

  it("should show the reftramo and the role of the selected outline", () => {
    const html = renderToStaticMarkup(React.createElement(EjesMapDetails, { subject, outline: subject.outlines[1] }));

    expect(html).toContain("1035386 · nuevo");
    expect(html).toContain("Tramo nuevo");
    expect(html).not.toContain("Haga clic en un tramo del mapa");
  });

  it("should list every outline to select, marking the selected one", () => {
    const html = renderToStaticMarkup(
      React.createElement(EjesMapDetails, { subject, outline: subject.outlines[1], selectedOutlineIndex: 1, onSelectOutline: NOOP })
    );

    expect(html).toContain("1001634 · anterior");
    expect(html).toContain("1035390 · nuevo");
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
  });

  it("should show the cut note only when the row has more outlines than one request carries", () => {
    const cut = { ...subject, total: 41 };

    expect(renderToStaticMarkup(React.createElement(EjesMapDetails, { subject: cut, outline: null }))).toContain(
      `Se muestran ${subject.items.length} de 41 tramos.`
    );
    expect(renderToStaticMarkup(React.createElement(EjesMapDetails, { subject: { ...subject, total: subject.items.length }, outline: null }))).not.toContain(
      "Se muestran"
    );
  });
});

describe("EjesMapDetails twin row (ET-9)", () => {
  const subject = subjectOfTwin(TWIN);
  const html = renderToStaticMarkup(React.createElement(EjesMapDetails, { subject, outline: null }));

  it("should show the idcalle, the department, every locality, the case text and the three lengths", () => {
    expect(html).toContain("idcalle");
    expect(html).toContain("72006");
    expect(html).toContain("Departamento");
    expect(html).toContain("FLORES");
    expect(html).toContain("FLORES RURAL, TRINIDAD");
    expect(html).toContain("Cerca de ambos: se mantienen las dos");
    expect(html).toContain("250.3");
    expect(html).toContain("Cerca de urbanos (m)");
    expect(html).toContain("120.5");
    expect(html).toContain("Cerca de rurales (m)");
    expect(html).toContain("30.0");
  });

  it("should show the decision of the row under Qué pasa: Se mantienen todas for BOTH", () => {
    expect(html).toContain("Qué pasa");
    expect(html).toContain("Se mantienen todas");
  });

  it("should show which localities would be dropped when the row has some", () => {
    const urban = subjectOfTwin({ ...TWIN, class: "URBAN", ruralLength: 0, dropLocalities: ["FLORES RURAL"] });
    const view = renderToStaticMarkup(React.createElement(EjesMapDetails, { subject: urban, outline: null }));

    expect(view).toContain("Se quitaría: FLORES RURAL");
    expect(view).not.toContain("Sin regla: se mantienen todas");
  });

  it("should say Se mantienen todas for an URBAN row with nothing to drop", () => {
    const urban = subjectOfTwin({ ...TWIN, class: "URBAN", ruralLength: 0, dropLocalities: [] });
    const view = renderToStaticMarkup(React.createElement(EjesMapDetails, { subject: urban, outline: null }));

    expect(view).toContain("Se mantienen todas");
    expect(view).not.toContain("Sin regla");
  });

  it("should say Sin regla: se mantienen todas for a NEITHER row", () => {
    const none = subjectOfTwin({ ...TWIN, class: "NEITHER", urbanLength: 0, ruralLength: 0, dropLocalities: [] });
    const view = renderToStaticMarkup(React.createElement(EjesMapDetails, { subject: none, outline: null }));

    expect(view).toContain("Sin regla: se mantienen todas");
  });

  it("should show the localities dropped from a RURAL row", () => {
    const rural = subjectOfTwin({ ...TWIN, class: "RURAL", urbanLength: 0, dropLocalities: ["TRINIDAD"] });
    const view = renderToStaticMarkup(React.createElement(EjesMapDetails, { subject: rural, outline: null }));

    expect(view).toContain("Se quitaría: TRINIDAD");
  });

  it("should not show the split and merge facts", () => {
    expect(html).not.toContain("Puntos de acceso");
    expect(html).not.toContain("Cobertura");
    expect(html).not.toContain("Nuevo fuera del anterior");
  });

  it("should show sin dato for a null length and a missing department or idcalle", () => {
    const empty = subjectOfTwin({ ...TWIN, idcalle: null, department: null, length: null, urbanLength: null, ruralLength: null });
    const text = renderToStaticMarkup(React.createElement(EjesMapDetails, { subject: empty, outline: null }));

    expect(text.match(/sin dato/g)?.length).toBeGreaterThanOrEqual(5);
  });

  it.each([
    ["URBAN", "Cerca de padrones urbanos"],
    ["RURAL", "Cerca de padrones rurales"],
    ["NEITHER", "Lejos de padrones: sin regla"],
  ] as const)("should show the case text of the class %s", (twinClass, text) => {
    const view = renderToStaticMarkup(
      React.createElement(EjesMapDetails, { subject: subjectOfTwin({ ...TWIN, class: twinClass }), outline: null })
    );

    expect(view).toContain(text);
  });

  it("should list the zones and the section to select, with the zone labels", () => {
    const list = renderToStaticMarkup(
      React.createElement(EjesMapDetails, { subject, outline: null, selectedOutlineIndex: null, onSelectOutline: NOOP })
    );

    expect(list).toContain("Padrones urbanos cercanos");
    expect(list).toContain("Padrones rurales cercanos");
    expect(list).toContain("1035386 · FLORES RURAL (se queda)");
    expect(list).toContain("1035386 · TRINIDAD (se queda)");
    expect(list).toContain("data-map-type=\"PADRON_ZONA_URBANA\"");
    expect(list).toContain("data-map-type=\"TRAMO_SE_QUEDA\"");
    expect(list).not.toContain("TRAMO_COPIA");
  });

  it("should list a zone with no length near no more than the copies", () => {
    const only = subjectOfTwin({ ...TWIN, class: "NEITHER", urbanLength: 0, ruralLength: 0 });
    const list = renderToStaticMarkup(
      React.createElement(EjesMapDetails, { subject: only, outline: null, selectedOutlineIndex: null, onSelectOutline: NOOP })
    );

    expect(list).not.toContain("Padrones urbanos cercanos");
    expect(list).not.toContain("Padrones rurales cercanos");
    expect(list.match(/<button/g)).toHaveLength(2);
  });

  it("should list every copy as its own selectable entry, even when the copies share a reftramo", () => {
    const list = renderToStaticMarkup(
      React.createElement(EjesMapDetails, { subject, outline: null, selectedOutlineIndex: 2, onSelectOutline: NOOP })
    );

    expect(list.match(/data-role="new"/g)).toHaveLength(4);
    expect(list.match(/aria-pressed="true"/g)).toHaveLength(1);
  });

  it("should show the reftramo, the locality and Se queda for a selected copy that stays", () => {
    const copy = subject.outlines.find((outline) => outline.locality === "TRINIDAD");
    const html = renderToStaticMarkup(React.createElement(EjesMapDetails, { subject, outline: copy ?? null }));

    expect(html).toContain("Localidad");
    expect(html).toContain("TRINIDAD");
    expect(html).toContain("Copia");
    expect(html).toContain("Se queda");
  });

  it("should show Se quitaría for a selected copy that would be dropped", () => {
    const urban = subjectOfTwin({ ...TWIN, class: "URBAN", ruralLength: 0, dropLocalities: ["FLORES RURAL"] });
    const copy = urban.outlines.find((outline) => outline.locality === "FLORES RURAL");
    const html = renderToStaticMarkup(React.createElement(EjesMapDetails, { subject: urban, outline: copy ?? null }));

    expect(html).toContain("FLORES RURAL");
    expect(html).toContain(">Se quitaría<");
  });

  it("should swatch a dropped copy as TRAMO_SE_QUITA and a kept one as TRAMO_SE_QUEDA", () => {
    const urban = subjectOfTwin({ ...TWIN, class: "URBAN", ruralLength: 0, dropLocalities: ["FLORES RURAL"] });
    const list = renderToStaticMarkup(
      React.createElement(EjesMapDetails, { subject: urban, outline: null, selectedOutlineIndex: null, onSelectOutline: NOOP })
    );

    expect(list).toContain("data-map-type=\"TRAMO_SE_QUITA\"");
    expect(list).toContain("data-map-type=\"TRAMO_SE_QUEDA\"");
    expect(list.indexOf("TRAMO_SE_QUITA")).toBeLessThan(list.indexOf("TRAMO_SE_QUEDA"));
  });

  it("should render a BOTH row with two zones and two copies without a duplicate React key", () => {
    const errors: unknown[][] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args);
    });
    try {
      const both = subjectOfTwin({ ...TWIN, class: "BOTH", urbanLength: 120.5, ruralLength: 30, dropLocalities: [] });
      renderToStaticMarkup(
        React.createElement(EjesMapDetails, { subject: both, outline: null, selectedOutlineIndex: null, onSelectOutline: NOOP })
      );
    } finally {
      spy.mockRestore();
    }

    expect(errors.filter((args) => String(args[0]).includes("same key"))).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("should show no Localidad or Copia fact for an outline of a split", () => {
    const split = subjectOfSplit(SPLIT);
    const html = renderToStaticMarkup(React.createElement(EjesMapDetails, { subject: split, outline: split.outlines[0] }));

    expect(html).not.toContain("Localidad");
    expect(html).not.toContain("Copia");
  });

  it("should say what a selected zone outline is", () => {
    const zone = renderToStaticMarkup(React.createElement(EjesMapDetails, { subject, outline: subject.outlines[0] }));

    expect(zone).toContain("Padrones cerca del tramo");
    expect(zone).toContain("1035386");
  });
});

describe("EjesMapModal (EM-11, EM-13, EM-15)", () => {
  it("should render nothing while closed or when the index points at no row", () => {
    expect(renderModal({ review: null })).toBe("");
    expect(renderModal({ review: { subjects: [subjectOfSplit(SPLIT)], index: 3 } })).toBe("");
  });

  it("should title the dialog by the kind of case on screen", () => {
    expect(renderModal()).toContain("División de tramo");
    expect(renderModal({ review: { subjects: [subjectOfSplit(SPLIT), subjectOfMerge(MERGE)], index: 1 } })).toContain(
      "Unión de tramos"
    );
  });

  it("should show the position among the rows of the table, with the way to the previous and next rows", () => {
    const html = renderModal({ review: { subjects: [subjectOfSplit(SPLIT), subjectOfMerge(MERGE)], index: 1 } });

    expect(html).toContain("2 de 2");
    expect(html).toContain("Anterior");
    expect(html).toContain("Siguiente");
  });

  it("should show the password notice instead of a map when the wizard holds no password", () => {
    const html = renderModal({ base: null });

    expect(html).toContain(EJES_CONNECTION_NOTICE);
    expect(html).not.toContain("Cargando geometrías");
  });

  it("should start loading the outlines when the wizard holds the password", () => {
    const html = renderModal();

    expect(html).toContain("Cargando geometrías");
    expect(html).not.toContain(EJES_CONNECTION_NOTICE);
  });

  it("should title the dialog Tramo repetido por localidad on a twin row and keep navigation within the twin table", () => {
    const second: EjesTwinRow = { ...TWIN, ref: "2000001" };
    const html = renderModal({ review: { subjects: [subjectOfTwin(TWIN), subjectOfTwin(second)], index: 1 } });

    expect(html).toContain("Tramo repetido por localidad");
    expect(html).toContain("2 de 2");
    expect(html).not.toContain("División de tramo");
    expect(html).not.toContain("Unión de tramos");
  });

  it("should show the facts of the row beside the map", () => {
    expect(renderModal()).toContain("72006");
  });
});
