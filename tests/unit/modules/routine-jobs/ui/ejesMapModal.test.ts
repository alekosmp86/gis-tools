import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { EjesMergeRow, EjesSplitRow } from "@/modules/routine-jobs/jobs/ejes-calles/types";
import type { EjesGeometryMapBase } from "@/modules/routine-jobs/ui/clientTypes";
import { EjesMapDetails } from "@/modules/routine-jobs/ui/EjesMapDetails";
import { EJES_PASSWORD_NOTICE, EjesMapModal } from "@/modules/routine-jobs/ui/EjesMapModal";
import { subjectOfMerge, subjectOfSplit } from "@/modules/routine-jobs/ui/ejesMapSubject";

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

const BASE: EjesGeometryMapBase = {
  connection: { host: "db.local", port: "5432", db_name: "gis", user: "gis_user", password: "pw" },
  tables: {
    "ejes-origen": { schema: "bdj_carto", table: "ide_ejesviacirculacion" },
    "ejes-tramos": { schema: "carto", table: "road_section" },
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

    expect(html).toContain(EJES_PASSWORD_NOTICE);
    expect(html).not.toContain("Cargando geometrías");
  });

  it("should start loading the outlines when the wizard holds the password", () => {
    const html = renderModal();

    expect(html).toContain("Cargando geometrías");
    expect(html).not.toContain(EJES_PASSWORD_NOTICE);
  });

  it("should show the facts of the row beside the map", () => {
    expect(renderModal()).toContain("72006");
  });
});
