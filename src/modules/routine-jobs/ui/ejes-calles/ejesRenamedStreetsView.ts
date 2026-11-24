import type { EjesRenamedStreetRow, EjesResult } from "../../jobs/ejes-calles/types";

export interface EjesRenamedNameChoice {
  idcalle: string;
  name: string;
}

export const renamedStreetRowsOf = (result: EjesResult): EjesRenamedStreetRow[] => result.renamedStreets ?? [];

export const renamedStreetKeyOf = (row: EjesRenamedStreetRow): string => row.idcalle;

export const renamedStreetNamesOf = (row: { newName: string | null; names?: string[] }): string[] =>
  row.names ?? (row.newName === null ? [] : [row.newName]);

/** A street whose file carries several names: the user chooses which one is written. */
export const renamedStreetNeedsChoice = (row: { newName: string | null; names?: string[] }): boolean =>
  renamedStreetNamesOf(row).length > 1;

export const renameChoiceOf = (choices: readonly EjesRenamedNameChoice[], idcalle: string): EjesRenamedNameChoice | undefined =>
  choices.find((choice) => choice.idcalle === idcalle);

/** A street can be accepted when it has one name, or when the user has chosen which of its several names to write. */
export const isRenamedStreetAcceptable = (
  row: EjesRenamedStreetRow,
  choices: readonly EjesRenamedNameChoice[] = []
): boolean => !renamedStreetNeedsChoice(row) || renameChoiceOf(choices, row.idcalle) !== undefined;
