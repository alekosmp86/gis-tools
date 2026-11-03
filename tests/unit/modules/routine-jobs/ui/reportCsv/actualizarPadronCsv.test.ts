import { describe, expect, it } from "vitest";
import {
  buildActualizarPadronCsv,
  buildActualizarPadronInconsistenciasCsv,
} from "@/modules/routine-jobs/ui/reportCsv/actualizarPadronCsv";
import type { ActualizarAddressMasterReport, ActualizarPadronResult, PadronGeometryChange, PadronInserted, PadronPair } from "@/modules/routine-jobs/jobs/actualizar-padron/types";
import { GEOMETRY_STATE, PAIR_CHANGE, PAIR_STATUS, PAIR_TIER, type PairStatus, type PairTier } from "@/modules/routine-jobs/jobs/actualizar-padron/constants";
import { DETAIL_LIST_LIMIT } from "@/modules/routine-jobs/jobs/shared/limits";
import { actualizarPadronResultOf, actualizarTargetReportOf, BOM, padronGeometryChangesOf, parseCsv } from "./reportCsvFixtures";

const HEADER = [
  "Tabla",
  "Cambio",
  "Tipo",
  "Provincia",
  "Localidad",
  "Padrón",
  "Id",
  "Área anterior (m²)",
  "Área nueva (m²)",
  "Cambio de área (%)",
  "Área no coincidente (%)",
  "Latitud",
  "Longitud",
  "Tipo anterior",
  "Localidad anterior",
  "Padrón anterior",
];
const TABLE = "carto.padron_tmp_actualizacion";
const INSERTED = "Insertada";
const MODIFIED = "Geometría modificada";
const DETECTED = "Geometría detectada (no aplicada)";
const CELL_COUNT = HEADER.length;
const INCONSISTENCY_HEADER = ["Motivo", "Departamento", "Localidad", "Padrón"];
const PENDING_PAIR_REASON = "Posible par pendiente (coincidencia parcial)";
const AMBIGUOUS_PAIR_REASON = "Posible par no aplicado (ambiguo)";
const markerOf = (shown: number, total: number, noun: string): string =>
  `Lista incompleta: se muestran las primeras ${shown} de ${total} ${noun}`;
const ANALYSIS_NOTE = "El análisis no lista los padrones nuevos ni los enlaces de direcciones: solo los muestra la carga real.";
const isCutMarkerRow = (row: string[]): boolean => row[1].startsWith("Lista incompleta");

const FORBIDDEN_TEXTS = [
  "Informe",
  "Modo",
  "Etapa",
  "Generado",
  "Resultado incierto",
  "Simulación",
  "Filas leídas",
  "Candidatas",
  "Omitidas",
  "Sin cambios",
  "Faltantes en destino",
  "Ambiguas",
  "Advertencia",
  "Estadísticas",
  "Tiempos",
  "Clasificar padrones",
  "Tabla de trabajo",
  "Localidad no encontrada",
  "Clave duplicada",
];

/** A data row padded with empty cells to the full width of the header. */
const rowFor = (cells: string[]): string[] => [...cells, ...Array.from({ length: CELL_COUNT - cells.length }, () => "")];

const rawCsvOf = (overrides: Partial<ActualizarPadronResult> = {}): string =>
  buildActualizarPadronCsv(actualizarPadronResultOf(overrides));

const rowsOf = (overrides: Partial<ActualizarPadronResult> = {}): string[][] => parseCsv(rawCsvOf(overrides));

const dataRowsOf = (overrides: Partial<ActualizarPadronResult> = {}): string[][] => rowsOf(overrides).slice(1);

const withTarget = (target: Parameters<typeof actualizarTargetReportOf>[0]): Partial<ActualizarPadronResult> => ({
  target: actualizarTargetReportOf(target),
});

const insertedOf = (overrides: Partial<PadronInserted> = {}): PadronInserted => ({
  id: 1,
  department: "CORDOBA",
  locality: "Villa Maria",
  typePadron: "URBANO",
  provinceId: 2,
  localityId: 10,
  number: "1",
  ...overrides,
});

const geometryOf = (overrides: Partial<PadronGeometryChange> & { number: string }): PadronGeometryChange => ({
  department: "JUJUY",
  locality: "Humahuaca",
  typePadron: "URBANO",
  provinceId: 3,
  localityId: 20,
  oldId: 555,
  state: GEOMETRY_STATE.APPLIED,
  oldAreaM2: 100,
  newAreaM2: 110,
  areaChangePct: 10,
  centroidLat: -34.9011,
  centroidLon: -56.1645,
  ...overrides,
});

const pairOf = ({ status, tier, number, oldId }: { status: PairStatus; tier: PairTier; number: string; oldId: number }): PadronPair => ({
  status,
  tier,
  oldId,
  changes: [PAIR_CHANGE.NUMBER],
  old: { typePadron: "URBANO", provinceId: 3, localityId: 20, number: "10", department: "JUJUY", locality: "Humahuaca" },
  new: { typePadron: "URBANO", provinceId: 3, localityId: 20, number, department: "JUJUY", locality: "Humahuaca" },
  overlap: 0.9,
  areaRatio: 0.95,
  oldAreaM2: 100,
  newAreaM2: 95,
  areaChangePct: 95,
  centroidLat: -34.9011,
  centroidLon: -56.1645,
});

describe("buildActualizarPadronCsv (AP-49)", () => {
  describe("envelope", () => {
    it("should start with the UTF-8 BOM", () => {
      expect(rawCsvOf().startsWith(BOM)).toBe(true);
    });

    it("should write the flat table header as the first row, with the Spanish column names and the area and location columns", () => {
      expect(rowsOf()[0]).toEqual(HEADER);
    });

    it("should separate rows with CRLF and end the body without a bare line feed", () => {
      const body = rawCsvOf({ target: actualizarTargetReportOf({ inserted: 0, insertedList: [], changed: 0, geometryChanges: [], updated: 0 }) })
        .slice(BOM.length)
        .replace(/\r\n$/, "");

      expect(body).toBe(HEADER.join(","));
    });

    it("should write only the header when the target has no inserted and no changed padrones", () => {
      const csv = rawCsvOf({ target: actualizarTargetReportOf({ inserted: 0, insertedList: [], changed: 0, geometryChanges: [], updated: 0 }) });

      expect(parseCsv(csv)).toEqual([HEADER]);
    });

    it("should write every row with the sixteen columns of the header", () => {
      expect(dataRowsOf().every((row) => row.length === CELL_COUNT)).toBe(true);
    });
  });

  describe("inserted rows (AP-42, AP-49)", () => {
    it("should write one Insertada row per inserted padron with its table, type, department, locality and number", () => {
      const rows = dataRowsOf({ target: actualizarTargetReportOf({ inserted: 1, insertedList: [insertedOf({ id: 9001, number: "100" })], changed: 0, geometryChanges: [], updated: 0 }) });

      expect(rows).toEqual([rowFor([TABLE, INSERTED, "URBANO", "CORDOBA", "Villa Maria", "100"])]);
    });

    it("should leave the id, the areas, the change percent and the coordinates empty for inserted padrones", () => {
      const rows = dataRowsOf();

      expect(rows.filter((row) => row[1] === INSERTED).every((row) => row.slice(6).every((cell) => cell === ""))).toBe(true);
    });

    it("should never write the internal id of an inserted padron", () => {
      const csv = rawCsvOf({ target: actualizarTargetReportOf({ inserted: 1, insertedList: [insertedOf({ id: 987654, number: "100" })], changed: 0, geometryChanges: [], updated: 0 }) });

      expect(csv).not.toContain("987654");
    });
  });

  describe("geometry rows (AP-44, AP-49)", () => {
    it("should write Geometría modificada with the destination id and the location cells for an applied geometry change", () => {
      const rows = dataRowsOf({ target: actualizarTargetReportOf({ inserted: 0, insertedList: [], geometryChanges: [geometryOf({ number: "7" })], changed: 1, updated: 1 }) });

      expect(rows).toEqual([rowFor([TABLE, MODIFIED, "URBANO", "JUJUY", "Humahuaca", "7", "555", "100", "110", "", "10", "-34.9011", "-56.1645"])]);
    });

    it("should write Geometría detectada (no aplicada) for every pending geometry change, each with its destination id", () => {
      const rows = dataRowsOf({
        target: actualizarTargetReportOf({
          updateApplied: false,
          inserted: 0,
          insertedList: [],
          updated: 0,
          geometryChanges: padronGeometryChangesOf(25, GEOMETRY_STATE.PENDING),
          changed: 25,
          geometryPending: 25,
        }),
      });
      const geometry = rows.filter((row) => row[1] === DETECTED || row[1] === MODIFIED);

      expect(geometry).toHaveLength(25);
      expect(geometry.every((row) => row[1] === DETECTED)).toBe(true);
      expect(geometry.every((row) => row[6] !== "")).toBe(true);
    });

    it("should write empty area, change percent and coordinate cells when the geometry change has no measure", () => {
      const rows = dataRowsOf({
        target: actualizarTargetReportOf({
          inserted: 0,
          insertedList: [],
          geometryChanges: [geometryOf({ number: "8", oldAreaM2: null, newAreaM2: null, areaChangePct: null, centroidLat: null, centroidLon: null })],
          changed: 1,
          updated: 1,
        }),
      });

      expect(rows).toEqual([rowFor([TABLE, MODIFIED, "URBANO", "JUJUY", "Humahuaca", "8", "555"])]);
    });
  });

  describe("content restrictions (AP-49)", () => {
    it("should write exactly the inserted and geometry rows, with no summary, count, warning or timing rows", () => {
      const rows = dataRowsOf();

      expect(rows).toHaveLength(50);
      expect(rows.every((row) => row[1] === INSERTED || row[1] === MODIFIED)).toBe(true);
    });

    it("should write no read, skipped, ambiguous, missing, warning, timing or classification text", () => {
      const csv = rawCsvOf();

      FORBIDDEN_TEXTS.forEach((text) => expect(csv).not.toContain(text));
    });

    it("should write the same padron rows in a dry run, then one note row that says the analysis lists no new padrones nor links", () => {
      const noteRow = rowFor([TABLE, ANALYSIS_NOTE]);

      expect(dataRowsOf({ dryRun: true })).toEqual([...dataRowsOf({ dryRun: false }), noteRow]);
    });

    it("should write the same rows when the outcome is unknown", () => {
      expect(dataRowsOf({ outcomeUnknown: true })).toEqual(dataRowsOf({ outcomeUnknown: false }));
    });
  });

  describe("ordering (AP-49)", () => {
    it("should list every inserted padron before every geometry change, whatever their departments", () => {
      const rows = dataRowsOf({
        target: actualizarTargetReportOf({
          inserted: 1,
          insertedList: [insertedOf({ department: "ZZZ", number: "1" })],
          changed: 1,
          updated: 1,
          geometryChanges: [geometryOf({ department: "AAA", number: "2" })],
        }),
      });

      expect(rows.map((row) => row[1])).toEqual([INSERTED, MODIFIED]);
    });

    it("should order inserted padrones by department, then locality, then number, comparing numbers numerically", () => {
      const rows = dataRowsOf({
        target: actualizarTargetReportOf({
          inserted: 4,
          insertedList: [
            insertedOf({ department: "JUJUY", locality: "A", number: "1" }),
            insertedOf({ department: "CORDOBA", locality: "B", number: "10" }),
            insertedOf({ department: "CORDOBA", locality: "B", number: "2" }),
            insertedOf({ department: "CORDOBA", locality: "A", number: "9" }),
          ],
          changed: 0,
          geometryChanges: [],
          updated: 0,
        }),
      });

      expect(rows.map((row) => [row[3], row[4], row[5]])).toEqual([
        ["CORDOBA", "A", "9"],
        ["CORDOBA", "B", "2"],
        ["CORDOBA", "B", "10"],
        ["JUJUY", "A", "1"],
      ]);
    });
  });

  describe("missing values (sin dato)", () => {
    it("should write sin dato for a missing department, locality, type and number", () => {
      const rows = dataRowsOf({
        target: actualizarTargetReportOf({
          inserted: 1,
          insertedList: [insertedOf({ department: null, locality: null, typePadron: null, number: null })],
          changed: 0,
          geometryChanges: [],
          updated: 0,
        }),
      });

      expect(rows).toEqual([rowFor([TABLE, INSERTED, "sin dato", "sin dato", "sin dato", "sin dato"])]);
    });
  });

  describe("quoting and hostile text", () => {
    it("should quote a locality containing commas and quotes so that it round-trips", () => {
      const csv = rawCsvOf({
        target: actualizarTargetReportOf({ inserted: 1, insertedList: [insertedOf({ locality: 'Villa "Norte", sur', number: "5" })], changed: 0, geometryChanges: [], updated: 0 }),
      });

      expect(csv).toContain('"Villa ""Norte"", sur"');
    });

    it("should neutralise formula triggers in every text cell", () => {
      const rows = dataRowsOf({
        target: actualizarTargetReportOf({
          inserted: 1,
          insertedList: [insertedOf({ department: "=CMD", locality: "+suma", typePadron: "@tipo", number: "-1" })],
          changed: 0,
          geometryChanges: [],
          updated: 0,
        }),
      });

      expect(rows).toEqual([rowFor([TABLE, INSERTED, "'@tipo", "'=CMD", "'+suma", "'-1"])]);
    });
  });

  describe("cut markers (MJ-14, AP-49)", () => {
    const cutInserted = (count: number) => Array.from({ length: count }, (_, index) => insertedOf({ id: index, number: String(index) }));
    const cutGeometry = (count: number) => Array.from({ length: count }, (_, index) => geometryOf({ number: String(index) }));

    it("should close the inserted list with one marker row when the real count exceeds the list", () => {
      const rows = dataRowsOf({
        target: actualizarTargetReportOf({
          inserted: DETAIL_LIST_LIMIT + 100,
          insertedList: cutInserted(DETAIL_LIST_LIMIT),
          changed: 0,
          geometryChanges: [],
          updated: 0,
        }),
      });

      expect(rows.at(-1)).toEqual(rowFor([TABLE, markerOf(DETAIL_LIST_LIMIT, DETAIL_LIST_LIMIT + 100, "padrones insertados")]));
    });

    it("should close the geometry list with one marker row when the real count exceeds the list", () => {
      const rows = dataRowsOf({
        target: actualizarTargetReportOf({
          inserted: 0,
          insertedList: [],
          changed: DETAIL_LIST_LIMIT + 1,
          updated: DETAIL_LIST_LIMIT + 1,
          geometryChanges: cutGeometry(DETAIL_LIST_LIMIT),
        }),
      });

      expect(rows.at(-1)?.[1]).toBe(markerOf(DETAIL_LIST_LIMIT, DETAIL_LIST_LIMIT + 1, "geometrías que cambian"));
    });

    it("should write one marker per cut list when both lists are cut", () => {
      const rows = dataRowsOf({
        target: actualizarTargetReportOf({
          inserted: DETAIL_LIST_LIMIT + 1,
          insertedList: cutInserted(DETAIL_LIST_LIMIT),
          changed: DETAIL_LIST_LIMIT + 2,
          updated: DETAIL_LIST_LIMIT + 2,
          geometryChanges: cutGeometry(DETAIL_LIST_LIMIT),
        }),
      });

      const markers = rows.filter((row) => row[1].startsWith("Lista incompleta"));
      expect(markers.map((row) => row[1])).toEqual([
        markerOf(DETAIL_LIST_LIMIT, DETAIL_LIST_LIMIT + 1, "padrones insertados"),
        markerOf(DETAIL_LIST_LIMIT, DETAIL_LIST_LIMIT + 2, "geometrías que cambian"),
      ]);
    });

    it("should write no marker when every list fits its real count", () => {
      const rows = dataRowsOf({
        target: actualizarTargetReportOf({
          inserted: DETAIL_LIST_LIMIT,
          insertedList: cutInserted(DETAIL_LIST_LIMIT),
          changed: DETAIL_LIST_LIMIT,
          updated: DETAIL_LIST_LIMIT,
          geometryChanges: cutGeometry(DETAIL_LIST_LIMIT),
        }),
      });

      expect(rows.some((row) => row[1].startsWith("Lista incompleta"))).toBe(false);
    });
  });

  describe("analysis cut markers (AP-88)", () => {
    const cutInserted = (count: number) => Array.from({ length: count }, (_, index) => insertedOf({ id: index, number: String(index) }));
    const addressMasterOf = (): ActualizarAddressMasterReport => ({
      table: "carto.direcciones_maestras",
      counts: { withoutAddressMaster: 3, created: 3, linked: 5, alreadyHadRecord: 0, ambiguous: 0, toCreate: 3, remaining: 0 },
      linkedList: [
        { id: 1, name: "Calle 1", provinceId: "02", addressMasterId: 501, created: true },
        { id: 2, name: "Calle 2", provinceId: "02", addressMasterId: 502, created: false },
      ],
      ambiguousSamples: [],
    });
    const cutTargetOf = (): Partial<ActualizarPadronResult> => ({
      target: actualizarTargetReportOf({
        inserted: DETAIL_LIST_LIMIT + 100,
        insertedList: cutInserted(DETAIL_LIST_LIMIT),
        changed: 0,
        geometryChanges: [],
        updated: 0,
      }),
    });

    it("should write the inserted cut marker in a real run that cuts the inserted list", () => {
      const rows = dataRowsOf({ ...cutTargetOf(), dryRun: false });

      expect(rows.filter(isCutMarkerRow).map((row) => row[1])).toEqual([
        markerOf(DETAIL_LIST_LIMIT, DETAIL_LIST_LIMIT + 100, "padrones insertados"),
      ]);
    });

    it("should write no inserted cut marker and close with the note row in a dry run that would cut the inserted list", () => {
      const rows = dataRowsOf({ ...cutTargetOf(), dryRun: true });

      expect(rows.some(isCutMarkerRow)).toBe(false);
      expect(rows.at(-1)).toEqual(rowFor([TABLE, ANALYSIS_NOTE]));
    });

    it("should write the inserted, created and linked cut markers in a real run and none of them in a dry run", () => {
      const overrides = { ...cutTargetOf(), addressMaster: addressMasterOf() };

      const realMarkers = dataRowsOf({ ...overrides, dryRun: false }).filter(isCutMarkerRow).map((row) => row[1]);
      const dryMarkers = dataRowsOf({ ...overrides, dryRun: true }).filter(isCutMarkerRow);

      expect(realMarkers).toEqual([
        markerOf(DETAIL_LIST_LIMIT, DETAIL_LIST_LIMIT + 100, "padrones insertados"),
        "Lista incompleta: se muestran las primeras 1 de 3 direcciones maestras creadas para padrones",
        "Lista incompleta: se muestran las primeras 2 de 5 padrones enlazados",
      ]);
      expect(dryMarkers).toEqual([]);
    });
  });

  describe("key updated rows (applied pairs)", () => {
    const STRICT_KEY_LABEL = "Clave actualizada";
    const LOOSE_KEY_LABEL = "Clave actualizada (coincidencia parcial)";

    const appliedPairOf = (tier: PairTier): PadronPair =>
      pairOf({ status: PAIR_STATUS.APPLIED, tier, number: "11", oldId: 555 });

    const pairTargetOf = (pair: PadronPair): Partial<ActualizarPadronResult> => ({
      target: actualizarTargetReportOf({
        inserted: 0,
        insertedList: [],
        changed: 0,
        geometryChanges: [],
        updated: 0,
        pairs: [pair],
        pairsTotal: 1,
        pairsApplied: 1,
        pairsLoose: pair.tier === PAIR_TIER.LOOSE ? 1 : 0,
      }),
    });

    it("should write Clave actualizada (coincidencia parcial) with the destination id and the old key for an applied LOOSE pair", () => {
      const rows = dataRowsOf(pairTargetOf(appliedPairOf(PAIR_TIER.LOOSE)));

      expect(rows).toEqual([rowFor([TABLE, LOOSE_KEY_LABEL, "URBANO", "JUJUY", "Humahuaca", "11", "555", "100", "95", "95", "", "-34.9011", "-56.1645", "URBANO", "Humahuaca", "10"])]);
    });

    it("should write Clave actualizada and never the partial-match label for an applied STRICT pair", () => {
      const rows = dataRowsOf(pairTargetOf(appliedPairOf(PAIR_TIER.STRICT)));

      expect(rows).toEqual([rowFor([TABLE, STRICT_KEY_LABEL, "URBANO", "JUJUY", "Humahuaca", "11", "555", "100", "95", "95", "", "-34.9011", "-56.1645", "URBANO", "Humahuaca", "10"])]);
    });
  });

  describe("removed rows (AP-108)", () => {
    const REMOVED_LABEL = "Eliminada";
    const removedTargetOf = (removedList: PadronInserted[], removed: number = removedList.length): Partial<ActualizarPadronResult> => ({
      dryRun: false,
      target: actualizarTargetReportOf({ inserted: 0, insertedList: [], changed: 0, geometryChanges: [], updated: 0, removed, removedList }),
    });

    it("should write one Eliminada row per deleted padron with its old key columns and the deleted destination id", () => {
      const rows = dataRowsOf(removedTargetOf([insertedOf({ id: 700, number: "700", locality: "Villa Maria" })]));

      expect(rows).toEqual([rowFor([TABLE, REMOVED_LABEL, "URBANO", "CORDOBA", "Villa Maria", "700", "700"])]);
    });

    it("should leave the areas, the change percent, the coordinates and the previous key empty for a deleted padron", () => {
      const [row] = dataRowsOf(removedTargetOf([insertedOf({ id: 700 })]));

      expect(row.slice(7)).toEqual(Array.from({ length: CELL_COUNT - 7 }, () => ""));
    });

    it("should write sin dato for a deleted padron missing its department and locality", () => {
      const [row] = dataRowsOf(removedTargetOf([insertedOf({ id: 701, department: null, locality: null })]));

      expect(row.slice(2, 5)).toEqual(["URBANO", "sin dato", "sin dato"]);
    });

    it("should write the deleted padrones after the inserted and the geometry rows, ordered by department, locality and number", () => {
      const rows = dataRowsOf({
        dryRun: false,
        target: actualizarTargetReportOf({
          inserted: 1,
          insertedList: [insertedOf({ id: 1, number: "5" })],
          changed: 0,
          geometryChanges: [],
          updated: 0,
          removed: 2,
          removedList: [insertedOf({ id: 20, number: "20" }), insertedOf({ id: 3, number: "3" })],
        }),
      });

      expect(rows.map((row) => [row[1], row[5]])).toEqual([[INSERTED, "5"], [REMOVED_LABEL, "3"], [REMOVED_LABEL, "20"]]);
    });

    it("should write no Eliminada row when nothing was deleted or the result lacks the removed list", () => {
      const rows = dataRowsOf({ dryRun: false, target: actualizarTargetReportOf({ inserted: 0, insertedList: [], changed: 0, geometryChanges: [], updated: 0 }) });

      expect(rows.some((row) => row[1] === REMOVED_LABEL)).toBe(false);
    });

    it("should close the removed list with the cut marker when the deleted count exceeds the list", () => {
      const list = Array.from({ length: DETAIL_LIST_LIMIT }, (_, index) => insertedOf({ id: index + 1, number: String(index + 1) }));

      const rows = dataRowsOf(removedTargetOf(list, DETAIL_LIST_LIMIT + 7));

      expect(rows.at(-1)).toEqual(rowFor([TABLE, markerOf(DETAIL_LIST_LIMIT, DETAIL_LIST_LIMIT + 7, "padrones eliminados")]));
      expect(rows.filter(isCutMarkerRow)).toHaveLength(1);
    });

    it("should write no cut marker when the deleted list holds every deleted padron", () => {
      const rows = dataRowsOf(removedTargetOf([insertedOf({ id: 1 }), insertedOf({ id: 2, number: "2" })]));

      expect(rows.some(isCutMarkerRow)).toBe(false);
    });
  });

  describe("target fixture passthrough", () => {
    it("should export the table name of the target report in every row", () => {
      const rows = dataRowsOf(withTarget({ table: "carto.padron" }));

      expect(rows.every((row) => row[0] === "carto.padron")).toBe(true);
    });
  });
});

describe("buildActualizarPadronInconsistenciasCsv (AP-61, AP-67)", () => {
  const noSkipsOf = (pairs: PadronPair[], pairsPending: number, pairsNotApplied: number): ActualizarPadronResult =>
    actualizarPadronResultOf({
      totals: { rowsRead: 0, candidates: 0, repaired: 0, skipped: 0 },
      target: actualizarTargetReportOf({ inserted: 0, insertedList: [], changed: 0, geometryChanges: [], updated: 0, pairs, pairsTotal: pairs.length, pairsPending, pairsNotApplied }),
    });

  it("should label a pending LOOSE pair as a pending possible pair and an ambiguous pair as an ambiguous one", () => {
    const result = noSkipsOf(
      [
        pairOf({ status: PAIR_STATUS.NOT_APPLIED_PENDING, tier: PAIR_TIER.LOOSE, number: "11", oldId: 555 }),
        pairOf({ status: PAIR_STATUS.NOT_APPLIED_AMBIGUOUS, tier: PAIR_TIER.STRICT, number: "21", oldId: 556 }),
      ],
      1,
      1
    );

    expect(parseCsv(buildActualizarPadronInconsistenciasCsv(result))).toEqual([
      INCONSISTENCY_HEADER,
      [PENDING_PAIR_REASON, "JUJUY", "Humahuaca", "11"],
      [AMBIGUOUS_PAIR_REASON, "JUJUY", "Humahuaca", "21"],
    ]);
  });

  it("should list a new padron that matched several destination rows once", () => {
    const result = noSkipsOf(
      [
        pairOf({ status: PAIR_STATUS.NOT_APPLIED_AMBIGUOUS, tier: PAIR_TIER.STRICT, number: "21", oldId: 555 }),
        pairOf({ status: PAIR_STATUS.NOT_APPLIED_AMBIGUOUS, tier: PAIR_TIER.STRICT, number: "21", oldId: 556 }),
      ],
      0,
      1
    );

    expect(parseCsv(buildActualizarPadronInconsistenciasCsv(result))).toEqual([
      INCONSISTENCY_HEADER,
      [AMBIGUOUS_PAIR_REASON, "JUJUY", "Humahuaca", "21"],
    ]);
  });
});
