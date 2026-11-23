import { EJES_TABLE_ROLE, type EjesTableRole } from "../../jobs/ejes-calles/constants";

export const EJES_DEPARTMENT_TEXT = {
  LABEL: "Departamento",
  ALL: "Todos",
  HINT: "Limita el análisis y la carga a un departamento; sin elegir se procesa todo el país.",
  SCOPE_PREFIX: "Alcance:",
} as const;

export const EJES_ROLE_TITLES: Record<EjesTableRole, string> = {
  [EJES_TABLE_ROLE.STAGING]: "Ejes de vía de circulación (origen)",
  [EJES_TABLE_ROLE.ROAD_SECTION]: "Tramos de calle",
  [EJES_TABLE_ROLE.CIRCULATION_WAY]: "Vías de circulación",
  [EJES_TABLE_ROLE.ADDRESS_MASTER]: "Direcciones maestras",
  [EJES_TABLE_ROLE.VERTICES]: "Vértices de ruteo",
  [EJES_TABLE_ROLE.ACCESS_POINT]: "Puntos de acceso",
  [EJES_TABLE_ROLE.LOCALITIES]: "Localidades INE",
  [EJES_TABLE_ROLE.DEPARTMENTS]: "Departamentos",
  [EJES_TABLE_ROLE.PADRONES]: "Padrones",
  [EJES_TABLE_ROLE.ADDRESS]: "Direcciones",
};
