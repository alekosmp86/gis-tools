import type { Feature, FeatureCollection, LineString, Point } from "geojson";
import { ExportFormat } from "../constants";
import type { AnalysisGroup, AnalysisRow } from "../types";

const CSV_LINE_BREAK = "\r\n";

const FILE_SUFFIX_BY_FORMAT: Readonly<Record<ExportFormat, string>> = {
  [ExportFormat.CSV]: ".csv",
  [ExportFormat.GEOJSON]: ".geojson",
  [ExportFormat.LINKS]: "_links.geojson",
};

export function buildExportFilename(provinceId: number, format: ExportFormat): string {
  return `address-dedup-provincia-${provinceId}${FILE_SUFFIX_BY_FORMAT[format]}`;
}

/** Column order of the CSV; mirrors the SQL select so files match the v3 deliverable plus the reason. */
export const EXPORT_COLUMNS = [
  "group_id",
  "fuente",
  "urn",
  "province",
  "locality",
  "street_name",
  "street_number",
  "letter",
  "square",
  "sandlot",
  "km",
  "padron",
  "type_padron",
  "postal_code",
  "lat",
  "lng",
  "document_type",
  "matched_serv_cto_tlk",
  "matched_nap_physical_device",
  "dup_group_size",
  "n_matched_in_group",
  "pool_rank_in_group",
  "decision",
  "decision_reason",
  "block",
  "tower",
  "floor",
  "unit",
  "code_country",
  "name_country",
  "id_province",
  "raw_rs_censal_locality_name",
  "raw_rs_censal_locality_code",
  "rs_cadastral_locality_name",
  "rs_idcalle",
  "raw_rs_name",
  "rs_reftramo",
  "rs_short_name",
  "raw_number",
  "side",
  "raw_padron_number",
] as const satisfies ReadonlyArray<keyof AnalysisRow>;

interface PointExport {
  readonly featureCollection: FeatureCollection<Point>;
  readonly skippedWithoutCoordinates: number;
}

function isLocatable(row: AnalysisRow): boolean {
  return (
    row.lat !== null &&
    row.lng !== null &&
    Number.isFinite(row.lat) &&
    Number.isFinite(row.lng)
  );
}

export function countWithoutCoordinates(rows: ReadonlyArray<AnalysisRow>): number {
  return rows.filter((row) => !isLocatable(row)).length;
}

function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  const needsQuoting = /[",\r\n]/.test(text) || text !== text.trim();
  return needsQuoting ? `"${text.replace(/"/g, '""')}"` : text;
}

/** RFC 4180: CRLF line breaks, quotes doubled, cells with separators, quotes, breaks or edge spaces quoted. */
export function rowsToCsv(rows: ReadonlyArray<AnalysisRow>): string {
  const header = EXPORT_COLUMNS.join(",");
  const lines = rows.map((row) =>
    EXPORT_COLUMNS.map((column) => escapeCsvCell(row[column])).join(",")
  );
  return [header, ...lines].join(CSV_LINE_BREAK) + CSV_LINE_BREAK;
}

function toExportProperties(row: AnalysisRow): Partial<AnalysisRow> {
  return Object.fromEntries(EXPORT_COLUMNS.map((column) => [column, row[column]]));
}

function toPointFeature(row: AnalysisRow): Feature<Point> {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [row.lng as number, row.lat as number] },
    properties: toExportProperties(row),
  };
}

/** One Point per locatable row, `[lng, lat]`; rows without usable coordinates are counted, not emitted. */
export function rowsToGeoJsonPoints(rows: ReadonlyArray<AnalysisRow>): PointExport {
  const locatableRows = rows.filter(isLocatable);
  return {
    featureCollection: { type: "FeatureCollection", features: locatableRows.map(toPointFeature) },
    skippedWithoutCoordinates: rows.length - locatableRows.length,
  };
}

function toLinkFeature(group: AnalysisGroup): Feature<LineString> | null {
  const locatableMembers = group.rows.filter(isLocatable);
  if (locatableMembers.length < 2) return null;

  return {
    type: "Feature",
    geometry: {
      type: "LineString",
      coordinates: locatableMembers.map((row) => [row.lng as number, row.lat as number]),
    },
    properties: { groupId: group.groupId, size: group.rows.length },
  };
}

/** One LineString per group joining its members, for QGIS; groups with fewer than two locatable members are skipped. */
export function groupsToGeoJsonLinks(
  groups: ReadonlyArray<AnalysisGroup>
): FeatureCollection<LineString> {
  const features = groups
    .map(toLinkFeature)
    .filter((feature): feature is Feature<LineString> => feature !== null);
  return { type: "FeatureCollection", features };
}
