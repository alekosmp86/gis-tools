import type { SelectFieldOption } from "@/ui-kit/types/ui";
import type { EjesTwinCopy, EjesTwinPick } from "../../jobs/ejes-calles/types";
import type { EjesTwinPickCopy } from "./ejesAccept";
import { textOrNoData } from "../shared/reportFormat";
import { EJES_TWIN_PICK_TEXT } from "./ejesTwinPickTexts";

const NO_COPY_VALUE = "";
const COPY_LABEL_SEPARATOR = " · ";

export const isPickableCopy = (copy: EjesTwinCopy): copy is EjesTwinPickCopy => copy.department !== null && copy.locality !== null;

export const copyLabelOf = (copy: EjesTwinPickCopy): string => `${copy.department}${COPY_LABEL_SEPARATOR}${copy.locality}`;

/** A copy as text; a missing department or locality shows as no data, so a copy that cannot be picked still reads. */
export const copyTextOf = (copy: EjesTwinCopy): string =>
  isPickableCopy(copy) ? copyLabelOf(copy) : `${textOrNoData(copy.department)}${COPY_LABEL_SEPARATOR}${textOrNoData(copy.locality)}`;

/** The placeholder, then one option per copy that can be picked; an option's value is the copy's index in `copies`. */
export const copyOptionsOf = (copies: readonly EjesTwinCopy[]): SelectFieldOption<string>[] => [
  { value: NO_COPY_VALUE, label: EJES_TWIN_PICK_TEXT.COPY_PLACEHOLDER },
  ...copies.flatMap((copy, index) => (isPickableCopy(copy) ? [{ value: String(index), label: copyLabelOf(copy) }] : [])),
];

export const selectedCopyValueOf = (copies: readonly EjesTwinCopy[], pick: EjesTwinPick | undefined): string => {
  if (pick === undefined) return NO_COPY_VALUE;
  const index = copies.findIndex(
    (copy) => isPickableCopy(copy) && copy.department === pick.department && copy.locality === pick.locality
  );
  return index === -1 ? NO_COPY_VALUE : String(index);
};

export const isChosenCopy = (copy: EjesTwinCopy, pick: EjesTwinPick | undefined): boolean =>
  pick !== undefined && isPickableCopy(copy) && copy.department === pick.department && copy.locality === pick.locality;

export const copyChangeOf =(copies: readonly EjesTwinCopy[], value: string): EjesTwinPickCopy | null => {
  if (value === NO_COPY_VALUE) return null;
  const copy = copies[Number(value)];
  return copy !== undefined && isPickableCopy(copy) ? copy : null;
};
