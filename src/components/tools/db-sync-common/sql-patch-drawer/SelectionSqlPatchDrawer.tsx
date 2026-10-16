import React from "react";
import { SqlPatchDrawer } from "./SqlPatchDrawer";
import {
  useSelectionSqlPatches,
  type UseSelectionSqlPatchesParams,
} from "./useSelectionSqlPatches";

export interface SelectionSqlPatchDrawerProps extends UseSelectionSqlPatchesParams {
  selectionVersion: number;
}

export const SelectionSqlPatchDrawer: React.FC<SelectionSqlPatchDrawerProps> = ({
  selectionVersion,
  ...patchParams
}) => {
  const patches = useSelectionSqlPatches(patchParams);

  return (
    <SqlPatchDrawer
      sqlUpdatePreview={patches.sqlUpdatePreview}
      sqlInsertPreview={patches.sqlInsertPreview}
      sqlUpdateCount={patches.sqlUpdateCount}
      sqlInsertCount={patches.sqlInsertCount}
      tableName={patchParams.dbConfig.table_name}
      dbConfig={patchParams.dbConfig}
      selectedCount={patches.selectedCount}
      selectionVersion={selectionVersion}
      onGenerateFullScript={patches.generateFullScript}
    />
  );
};
