import type { PadronGeometryChange, PadronKey, PadronLocation } from "../jobs/actualizar-padron/types";
import { geometryStateLabelOf } from "./actualizarPadronReportView";
import type { TableColumn } from "./ReportParts";
import { decimalOrNoData, NO_DATA_TEXT, textOrNoData } from "./reportFormat";

const AREA_DECIMAL_PLACES = 1;
const PERCENT_DECIMAL_PLACES = 1;
const COORDINATE_DECIMAL_PLACES = 6;
const NON_OVERLAP_HEADER = "Área no coincidente (%)";

export const idOrNoData = (value: number | null): string => (value === null ? NO_DATA_TEXT : String(value));

export const keyContentOf = (key: PadronKey): string => `${key.typePadron}|${key.provinceId}|${key.localityId}|${key.number}`;

export const TYPE_COLUMN: TableColumn<PadronKey> = { header: "Tipo", cell: (key) => textOrNoData(key.typePadron) };
export const NUMBER_COLUMN: TableColumn<PadronKey> = { header: "Padrón", cell: (key) => textOrNoData(key.number) };

const locationColumnsOf = <Row extends PadronLocation>(areaChangeHeader: string): TableColumn<Row>[] => [
  { header: "Área anterior (m²)", cell: (row) => decimalOrNoData(row.oldAreaM2, AREA_DECIMAL_PLACES) },
  { header: "Área nueva (m²)", cell: (row) => decimalOrNoData(row.newAreaM2, AREA_DECIMAL_PLACES) },
  { header: areaChangeHeader, cell: (row) => decimalOrNoData(row.areaChangePct, PERCENT_DECIMAL_PLACES) },
  { header: "Latitud", cell: (row) => decimalOrNoData(row.centroidLat, COORDINATE_DECIMAL_PLACES) },
  { header: "Longitud", cell: (row) => decimalOrNoData(row.centroidLon, COORDINATE_DECIMAL_PLACES) },
];

export const GEOMETRY_COLUMNS: TableColumn<PadronGeometryChange>[] = [
  TYPE_COLUMN,
  { header: "Departamento", cell: (change) => textOrNoData(change.department) },
  { header: "Localidad", cell: (change) => textOrNoData(change.locality) },
  NUMBER_COLUMN,
  { header: "Id actual", cell: (change) => idOrNoData(change.oldId) },
  ...locationColumnsOf<PadronGeometryChange>(NON_OVERLAP_HEADER),
  { header: "Estado", cell: (change) => geometryStateLabelOf(change.state) },
];
