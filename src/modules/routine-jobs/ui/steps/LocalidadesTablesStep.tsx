"use client";

import React from "react";
import type { ResolvedColumn, TableListing } from "@/core/types/tableCatalog";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { AlertType } from "@/ui-kit/types/ui";
import type { LocalidadesTableRole } from "../../jobs/cargar-localidades/constants";
import type {
  FixedTable,
  LocalidadesDestination,
  LocalidadesExcludedTables,
  LocalidadesTargetDraft,
} from "../cargarLocalidadesWizardState";
import { LocalidadesSourceTables } from "./LocalidadesSourceTables";
import { LocalidadesTargetTables } from "./LocalidadesTargetTables";
import styles from "./WizardSteps.module.css";

const CATALOG_ERROR_MESSAGE = "No se pudo consultar la base. Revise la conexión.";

export interface LocalidadesTablesStepProps {
  stagingSchema: string;
  provinceSchema: string;
  tables: Record<FixedTable, string>;
  excluded: LocalidadesExcludedTables;
  targets: Record<LocalidadesDestination, LocalidadesTargetDraft>;
  onStagingSchemaChange: (schema: string) => void;
  onProvinceSchemaChange: (schema: string) => void;
  onTableChange: (key: FixedTable, table: string, valid: boolean) => void;
  onTargetSchemaChange: (destination: LocalidadesDestination, schema: string) => void;
  onTargetTableChange: (destination: LocalidadesDestination, table: string, valid: boolean) => void;
  onTargetIncludedChange: (destination: LocalidadesDestination, included: boolean) => void;
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
  onTargetIncludedChange,
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
      excluded={excluded}
      onStagingSchemaChange={onStagingSchemaChange}
      onProvinceSchemaChange={onProvinceSchemaChange}
      onTableChange={onTableChange}
      loadTables={loadTables}
      checkColumns={checkColumns}
      hideListError={catalogError !== null}
    />
    <LocalidadesTargetTables
      targets={targets}
      excluded={excluded}
      onSchemaChange={onTargetSchemaChange}
      onTableChange={onTargetTableChange}
      onIncludedChange={onTargetIncludedChange}
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
