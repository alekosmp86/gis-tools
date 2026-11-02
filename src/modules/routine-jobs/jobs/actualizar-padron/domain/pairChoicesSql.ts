import { DESTINATION_COLUMN } from "../constants";
import type { PairChoice } from "../types";
import { typedValuesSql, type TypedColumn } from "./typedValuesSql";

export const CHOICE_OLD_ID_COLUMN = "old_id";

/** The new padrón key columns shared by the pair choices and the accepted geometries, in the order of PairChoiceKeyFields. */
export const NEW_KEY_VALUE_COLUMNS: readonly TypedColumn[] = [
  [DESTINATION_COLUMN.TYPE_PADRON, "text"],
  [DESTINATION_COLUMN.ID_PROVINCE, "integer"],
  [DESTINATION_COLUMN.ID_CADASTRAL_LOCALITY, "integer"],
  [DESTINATION_COLUMN.NUMBER, "text"],
];

const CHOICE_COLUMNS: readonly TypedColumn[] = [...NEW_KEY_VALUE_COLUMNS, [CHOICE_OLD_ID_COLUMN, "integer"]];

/** The body of the pair_choices CTE: one typed row per choice, or no rows of the same shape when there are none. */
export function pairChoicesValuesSql(choices: readonly PairChoice[]): string {
  const rows = choices.map((choice) => [choice.typePadron, choice.provinceId, choice.localityId, choice.number, choice.oldId]);
  return typedValuesSql(CHOICE_COLUMNS, rows, "choices");
}
