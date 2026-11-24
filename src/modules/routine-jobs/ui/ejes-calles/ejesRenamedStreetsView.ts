import type { EjesRenamedStreetRow, EjesResult } from "../../jobs/ejes-calles/types";

export const renamedStreetRowsOf = (result: EjesResult): EjesRenamedStreetRow[] => result.renamedStreets ?? [];

export const renamedStreetKeyOf = (row: EjesRenamedStreetRow): string => row.idcalle;

export const isRenamedStreetAcceptable = (row: EjesRenamedStreetRow): boolean => !row.multiName;
