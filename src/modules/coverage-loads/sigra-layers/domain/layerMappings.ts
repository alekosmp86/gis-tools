import { SigraLayerId } from "../constants";
import {
  ComputedKind,
  type ColumnMapping,
  type ComputedColumn,
  type DerivedColumn,
  type LayerMapping,
} from "../types";
import { ZONAS_FTTH_DERIVED_COLUMNS } from "./zonasFtthDerivations";

type Pairs = ReadonlyArray<readonly [column: string, property: string]>;

const NO_DERIVED: ReadonlyArray<DerivedColumn> = [];

const LOAD_DATE: ComputedColumn = { column: "fechaact", kind: ComputedKind.LOAD_DATE };
const LOAD_DATE_TFO: ComputedColumn = { column: "fechacarga", kind: ComputedKind.LOAD_DATE };
const SOURCE: ComputedColumn = { column: "fuente", kind: ComputedKind.SOURCE };
const AREA: ComputedColumn = { column: "area_m2", kind: ComputedKind.AREA };
const ROUNDED_AREA: ComputedColumn = { column: "area_m2", kind: ComputedKind.ROUNDED_AREA };
const LATITUDE: ComputedColumn = { column: "latitud", kind: ComputedKind.LATITUDE };
const LONGITUDE: ComputedColumn = { column: "longitud", kind: ComputedKind.LONGITUDE };

const DATED: ReadonlyArray<ComputedColumn> = [LOAD_DATE];
const DATED_WITH_SOURCE: ReadonlyArray<ComputedColumn> = [LOAD_DATE, SOURCE];
const DATED_WITH_AREA_AND_SOURCE: ReadonlyArray<ComputedColumn> = [LOAD_DATE, AREA, SOURCE];

function mapping(
  pairs: Pairs,
  computed: ReadonlyArray<ComputedColumn>,
  derived: ReadonlyArray<DerivedColumn> = NO_DERIVED,
): LayerMapping {
  const direct: ColumnMapping[] = pairs.map(([column, property]) => ({ column, property }));
  return { direct, derived, computed };
}

const CENTRAL_LIMIT_PAIRS = (centralNameColumn: string): Pairs => [
  ["id_area", "ID_AREA"],
  ["edificio", "EDIFICIO"],
  ["id_sitio", "ID_SITIO"],
  ["codigo_sitio", "EDIFICIO"],
  [centralNameColumn, "CENTRAL_NOMBRE"],
  ["cr_site_ty", "CR_SITE_TYPE_ID"],
];

const ADMINISTRATIVE_AREA_PAIRS: Pairs = [
  ["id_area", "ID_AREA"],
  ["codigo", "CODIGO"],
  ["edificio", "EDIFICIO"],
  ["area_tipo", "AREA_TIPO"],
  ["clasificacion", "CLASIFICACION"],
  ["observacion", "OBSERVACION"],
];

const CENTRAL_SITE_PAIRS = (centralNameColumn: string): Pairs => [
  ["id_sitio", "ID"],
  ["codigo_sitio", "EDIFICIO"],
  [centralNameColumn, "NOMBRE"],
  ["rotation", "ROTATION"],
  ["tipo_de_central", "TIPO_DE_CENTRAL"],
];

const ZONAS_FTTH_PAIRS: Pairs = [
  ["id_distrito", "ID_AREA"],
  ["identificacion_de_la_central", "EDIFICIO"],
  ["codigo_distrito", "CODIGO_AREA"],
  ["nombre_central", "CENTRAL_NOMBRE"],
  ["situacion_distrito", "SITUACION"],
  ["id_terminalfibraoptica", "ID_EMPALME"],
  ["codigo_terminalfibraoptica", "CODIGO_EMPALME"],
  ["situacion_geom", "SITUACION_GEOM"],
];

const AREA_CD_SR_PAIRS: Pairs = [
  ["id_area_sgra", "ID"],
  ["codigo", "CODIGO"],
  ["edificio", "EDIFICIO"],
  ["situacion", "SITUACION"],
];

const AREA_CABLE_COBRE_PAIRS: Pairs = [
  ["edificio", "EDIFICIO"],
  ["codigo", "CODIGO"],
  ["tipo_area", "TIPO_AREA"],
  ["id", "ID_AREA_SGRA"],
  ["situacion", "SITUACION"],
];

const AREA_CABLE_FTTH_PAIRS: Pairs = [
  ["id_area", "ID_AREA"],
  ["edificio", "EDIFICIO"],
  ["identificacion_central", "IDENTIFICACION_CENTRAL"],
  ["nombre_central", "NOMBRE_CENTRAL"],
  ["codigo", "CODIGO"],
  ["situacion", "SITUACION"],
  ["tipo_area", "TIPO_AREA"],
];

const AREA_CAJITAS_COBRE_PAIRS: Pairs = [
  ["id_area", "ID_AREA"],
  ["codigo_area", "CODIGO_AREA"],
  ["central_nombre", "CENTRAL_NOMBRE"],
  ["edificio", "EDIFICIO"],
  ["situacion", "SITUACION"],
  ["id_cajita", "ID_CAJITA"],
  ["codigo_cajita", "CODIGO_CAJITA"],
  ["caja_de_distribucion", "CAJA_DE_DISTRIBUCION"],
];

const AREA_TFO_PAIRS: Pairs = [
  ["id_area_tfo", "ID"],
  ["edificio", "EDIFICIO"],
  ["cable", "CABLE"],
  ["zona", "ZONA"],
  ["codigo_area", "CODIGO"],
  ["situacion_area", "SITUACION"],
];

const CAJA_DISTRIBUCION_PAIRS: Pairs = [
  ["id", "ID"],
  ["central", "CENTRAL"],
  ["code", "CODE"],
  ["status", "STATUS"],
];

const CAJITAS_COBRE_PAIRS: Pairs = [
  ["cd", "CD"],
  ["activa", "ACTIVA"],
  ["cajita_id", "CAJITA_ID"],
  ["edificio", "EDIFICIO"],
  ["nro", "NRO"],
];

const TFO_DIVISORES_PAIRS: Pairs = [
  ["id_terminalfibra", "TFOID"],
  ["edificio_terminalfibra", "TFOEDIFICIO"],
  ["cable_terminalfibra", "TFOCABLE"],
  ["zona_terminalfibra", "TFOZONA"],
  ["codigo_terminalfibra", "TFOCODIGO"],
  ["situacion_terminalfibra", "TFOSTATUS"],
  ["observacion", "TFOOBS"],
  ["codigo_divisoroptico", "DIVISOR"],
  ["situacion_divisoroptico", "DIVISORSTATUS"],
  ["spid", "SPID"],
];

const CAMARAS_PAIRS: Pairs = [
  ["id_sgra", "ID_SGRA"],
  ["edificio", "EDIFICIO"],
  ["codigo", "CODIGO"],
  ["tipo", "TIPO"],
  ["situacion", "SITUACION"],
];

const POSTES_PAIRS: Pairs = [
  ["id_sgra", "ID"],
  ["tipo", "TIPO"],
  ["codigo_sga", "CODIGO_SGA"],
  ["altura", "ALTURA"],
  ["material", "MATERIAL"],
  ["situacion", "SITUACION"],
  ["perforada", "PERFORADA"],
  ["base_hormigonada", "BASE_HORMIGONADA"],
  ["rotation", "ROTATION"],
];

export const LAYER_MAPPINGS: Readonly<Record<SigraLayerId, LayerMapping>> = {
  [SigraLayerId.ZONAS_FTTH]: mapping(ZONAS_FTTH_PAIRS, DATED_WITH_SOURCE, ZONAS_FTTH_DERIVED_COLUMNS),
  [SigraLayerId.LIMITE_CENTRAL_FTTH]: mapping(CENTRAL_LIMIT_PAIRS("nombre_central_ftth"), DATED_WITH_AREA_AND_SOURCE),
  [SigraLayerId.LIMITE_CENTRAL_COBRE]: mapping(CENTRAL_LIMIT_PAIRS("nombre_central_cobre"), DATED_WITH_AREA_AND_SOURCE),
  [SigraLayerId.AREA_CD_SR]: mapping(AREA_CD_SR_PAIRS, DATED),
  [SigraLayerId.AREA_CABLE_COBRE]: mapping(AREA_CABLE_COBRE_PAIRS, DATED),
  [SigraLayerId.AREA_CABLE_FTTH]: mapping(AREA_CABLE_FTTH_PAIRS, [LOAD_DATE, ROUNDED_AREA, SOURCE]),
  [SigraLayerId.AREA_CAJITAS_COBRE]: mapping(AREA_CAJITAS_COBRE_PAIRS, DATED),
  [SigraLayerId.AREA_TFO]: mapping(AREA_TFO_PAIRS, DATED_WITH_SOURCE),
  [SigraLayerId.LIMITE_ECONOMICO_COBRE]: mapping(ADMINISTRATIVE_AREA_PAIRS, DATED_WITH_AREA_AND_SOURCE),
  [SigraLayerId.LIMITE_MIXTO_COBRE]: mapping(ADMINISTRATIVE_AREA_PAIRS, DATED_WITH_AREA_AND_SOURCE),
  [SigraLayerId.ZONAS_INSEGURIDAD]: mapping(ADMINISTRATIVE_AREA_PAIRS, DATED_WITH_AREA_AND_SOURCE),
  [SigraLayerId.CAJA_DISTRIBUCION]: mapping(CAJA_DISTRIBUCION_PAIRS, DATED),
  [SigraLayerId.CAJITAS_COBRE]: mapping(CAJITAS_COBRE_PAIRS, DATED),
  [SigraLayerId.TFO_DIVISORES]: mapping(TFO_DIVISORES_PAIRS, [LOAD_DATE_TFO, SOURCE]),
  [SigraLayerId.CAMARAS]: mapping(CAMARAS_PAIRS, DATED),
  [SigraLayerId.CENTRALES_COBRE]: mapping(CENTRAL_SITE_PAIRS("nombre_central_cobre"), DATED_WITH_SOURCE),
  [SigraLayerId.CENTRALES_FTTH]: mapping(CENTRAL_SITE_PAIRS("nombre_central_ftth"), DATED_WITH_SOURCE),
  [SigraLayerId.POSTES]: mapping(POSTES_PAIRS, [LOAD_DATE, LATITUDE, LONGITUDE, SOURCE]),
};
