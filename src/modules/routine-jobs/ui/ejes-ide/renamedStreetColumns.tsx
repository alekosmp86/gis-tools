"use client";

import React from "react";
import { SelectField } from "@/ui-kit/components/ui/SelectField";
import type { SelectFieldOption } from "@/ui-kit/types/ui";
import type { EjesRenamedStreetRow } from "../../jobs/ejes-ide/types";
import type { TableColumn } from "../shared/ReportParts";
import { textOrNoData } from "../shared/reportFormat";
import { NO_RENAME_CHANGE, renameChoicesOfAccept, type EjesAcceptView, type EjesRenameChoiceChange } from "./ejesAccept";
import { EJES_ACCEPT_TEXT } from "./ejesAcceptTexts";
import { RENAMED_NEW_NAME_HEADER, RENAMED_STREET_LEADING_COLUMNS, RENAMED_STREET_TRAILING_COLUMNS } from "./ejesReportColumns";
import {
  isRenamedStreetAcceptable,
  renameChoiceOf,
  renamedStreetNamesOf,
  renamedStreetNeedsChoice,
  type EjesRenamedNameChoice,
} from "./ejesRenamedStreetsView";
import styles from "./EjesAccept.module.css";

const NO_NAME_VALUE = "";

const nameOptionsOf = (row: EjesRenamedStreetRow): SelectFieldOption<string>[] => [
  { value: NO_NAME_VALUE, label: EJES_ACCEPT_TEXT.RENAME_CHOOSE_NAME },
  ...renamedStreetNamesOf(row).map((name) => ({ value: name, label: name })),
];

interface RenamedNameCellProps {
  row: EjesRenamedStreetRow;
  chosen: EjesRenamedNameChoice | undefined;
  onChange: (change: EjesRenameChoiceChange) => void;
}

const RenamedNameCell: React.FC<RenamedNameCellProps> = ({ row, chosen, onChange }) => (
  <div className={styles.nameCell}>
    <SelectField
      label={EJES_ACCEPT_TEXT.RENAME_CHOICE_LABEL}
      value={chosen?.name ?? NO_NAME_VALUE}
      options={nameOptionsOf(row)}
      onChange={(value) => onChange({ idcalle: row.idcalle, name: value === NO_NAME_VALUE ? null : value })}
    />
  </div>
);

/** A street with several names keeps its toggle disabled until the user chooses one. */
export const renamedToggleDisabledOf = (accept: EjesAcceptView) => (row: EjesRenamedStreetRow): boolean =>
  !isRenamedStreetAcceptable(row, renameChoicesOfAccept(accept));

/** A street with one name shows it; a street with several shows the select of the names the file carries. */
export const renamedStreetColumnsOf = (accept: EjesAcceptView): TableColumn<EjesRenamedStreetRow>[] => {
  const choices = renameChoicesOfAccept(accept);
  const onChange = accept.onRenameChoiceChange ?? NO_RENAME_CHANGE;
  const newNameCell = (row: EjesRenamedStreetRow): React.ReactNode =>
    renamedStreetNeedsChoice(row) ? (
      <RenamedNameCell row={row} chosen={renameChoiceOf(choices, row.idcalle)} onChange={onChange} />
    ) : (
      textOrNoData(row.newName)
    );
  return [
    ...RENAMED_STREET_LEADING_COLUMNS,
    { header: RENAMED_NEW_NAME_HEADER, cell: newNameCell },
    ...RENAMED_STREET_TRAILING_COLUMNS,
  ];
};
