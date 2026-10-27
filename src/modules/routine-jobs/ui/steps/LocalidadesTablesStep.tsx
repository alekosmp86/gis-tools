"use client";

import React from "react";
import type { ResolvedColumn, TableListing } from "@/core/types/tableCatalog";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { AlertType } from "@/ui-kit/types/ui";
import type { LocalidadesTableRole } from "../../jobs/cargar-localidades/constants";
import type { FixedTable, LocalidadesExcludedTables, LocalidadesTargetDraft } from "../cargarLocalidadesWizardState";
import { LocalidadesSourceTables } from "./LocalidadesSourceTables";
import { LocalidadesTargetTables } from "./LocalidadesTargetTables";
import styles from "./WizardSteps.module.css";

const CATALOG_ERROR_MESSAGE = "No se pudo consultar la base. Revise la conexión.";

export interface LocalidadesTablesStepProps {
  stagingSchema: string;
  provinceSchema: string;
  tables: Record<FixedTable, string>;
  excluded: LocalidadesExcludedTables;
  targets: LocalidadesTargetDraft[];
  onStagingSchemaChange: (schema: string) => void;
  onProvinceSchemaChange: (schema: string) => void;
  onTableChange: (key: FixedTable, table: string, valid: boolean) => void;
  onTargetSchemaChange: (index: number, schema: string) => void;
  onTargetTableChange: (index: number, table: string, valid: boolean) => void;
  onTargetAdd: () => void;
  onTargetRemove: (index: number) => void;
  loadTables: (schema: string) => Promise<TableListing>;
  checkColumns: (role: LocalidadesTableRole, schema: string, table: string) => Promise<ResolvedColumn[]>;
  blockingReason: string | null;
  catalogError: string | null;
}

export const LocalidadesTablesStep: React.FC<LocalidadesTablesStepProps> = ({
  stagingSchema,
  provinceSchema,
  tables,
  excluded,
  targets,
  onStagingSchemaChange,
  onProvinceSchemaChange,
  onTableChange,
  onTargetSchemaChange,
  onTargetTableChange,
  onTargetAdd,
  onTargetRemove,
  loadTables,
  checkColumns,
  blockingReason,
  catalogError,
}) => (
  <div className={styles.stack}>
    <LocalidadesSourceTables
      stagingSchema={stagingSchema}
      provinceSchema={provinceSchema}
      tables={tables}
      excluded={excluded.fixed}
      onStagingSchemaChange={onStagingSchemaChange}
      onProvinceSchemaChange={onProvinceSchemaChange}
      onTableChange={onTableChange}
      loadTables={loadTables}
      checkColumns={checkColumns}
      hideListError={catalogError !== null}
    />
    <LocalidadesTargetTables
      targets={targets}
      excluded={excluded.targets}
      onSchemaChange={onTargetSchemaChange}
      onTableChange={onTargetTableChange}
      onAdd={onTargetAdd}
      onRemove={onTargetRemove}
      loadTables={loadTables}
      checkColumns={checkColumns}
      hideListError={catalogError !== null}
    />
    {catalogError !== null && (
      <div role="alert">
        <AlertMessage type={AlertType.ERROR} text={`${CATALOG_ERROR_MESSAGE} ${catalogError}`} />
      </div>
    )}
    {blockingReason !== null && <AlertMessage type={AlertType.WARNING} text={blockingReason} />}
  </div>
);
