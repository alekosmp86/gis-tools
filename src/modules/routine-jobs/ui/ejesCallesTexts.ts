import { EJES_TABLE_ROLE, type EjesTableRole } from "../jobs/ejes-calles/constants";

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
};
