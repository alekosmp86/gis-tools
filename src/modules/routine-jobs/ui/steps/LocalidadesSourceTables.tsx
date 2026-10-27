"use client";

import React from "react";
import type { ResolvedColumn, TableListing } from "@/core/types/tableCatalog";
import { TableSelector } from "@/ui-kit/components/TableSelector";
import { LOCALIDADES_TABLE_ROLE, type LocalidadesTableRole } from "../../jobs/cargar-localidades/constants";
import { FixedTable } from "../cargarLocalidadesWizardState";
import { SchemaDraftField } from "./SchemaDraftField";
import styles from "./WizardSteps.module.css";

const STAGING_SCHEMA_LABEL = "Esquema de padrones y localidades de origen";
const PROVINCE_SCHEMA_LABEL = "Esquema de provincias";
const SCHEMA_HINT =
  "La tabla de padrones y la de localidades de origen comparten esquema. La de provincias puede estar en otro.";

interface SourceSelector {
  key: FixedTable;
  label: string;
  role: LocalidadesTableRole;
}

const SELECTORS: readonly SourceSelector[] = [
  { key: FixedTable.PADRON, label: "Tabla de padrones (staging)", role: LOCALIDADES_TABLE_ROLE.STAGING_PADRON },
  { key: FixedTable.LOCALITY, label: "Tabla de localidades de origen", role: LOCALIDADES_TABLE_ROLE.STAGING_LOCALIDAD },
  { key: FixedTable.PROVINCE, label: "Tabla de provincias", role: LOCALIDADES_TABLE_ROLE.PROVINCE },
];

const isBlank = (value: string): boolean => value.trim() === "";

export interface LocalidadesSourceTablesProps {
  stagingSchema: string;
  provinceSchema: string;
  tables: Record<FixedTable, string>;
  excluded: Record<FixedTable, string[]>;
  onStagingSchemaChange: (schema: string) => void;
  onProvinceSchemaChange: (schema: string) => void;
  onTableChange: (key: FixedTable, table: string, valid: boolean) => void;
  loadTables: (schema: string) => Promise<TableListing>;
  checkColumns: (role: LocalidadesTableRole, schema: string, table: string) => Promise<ResolvedColumn[]>;
  hideListError: boolean;
}

export const LocalidadesSourceTables: React.FC<LocalidadesSourceTablesProps> = ({
  stagingSchema,
  provinceSchema,
  tables,
  excluded,
  onStagingSchemaChange,
  onProvinceSchemaChange,
  onTableChange,
  loadTables,
  checkColumns,
  hideListError,
}) => {
  const schemaOf = (key: FixedTable): string => (key === FixedTable.PROVINCE ? provinceSchema : stagingSchema);
  return (
    <div className={styles.schemaBlock}>
      <div className={styles.schemaPair}>
        <SchemaDraftField
          label={STAGING_SCHEMA_LABEL}
          initial={stagingSchema}
          committed={stagingSchema}
          onCommit={onStagingSchemaChange}
        />
        <SchemaDraftField
          label={PROVINCE_SCHEMA_LABEL}
          initial={provinceSchema}
          committed={provinceSchema}
          onCommit={onProvinceSchemaChange}
        />
      </div>
      <p className={styles.schemaHint}>{SCHEMA_HINT}</p>
      <div className={styles.tablesGrid}>
        {SELECTORS.map(({ key, label, role }) => (
          <TableSelector
            key={key}
            label={label}
            schema={schemaOf(key)}
            value={tables[key]}
            onChange={(table) => onTableChange(key, table, false)}
            loadTables={loadTables}
            checkColumns={(table) => checkColumns(role, schemaOf(key).trim(), table)}
            disabled={isBlank(schemaOf(key))}
            excludedTables={excluded[key]}
            onValidityChange={(valid) => onTableChange(key, tables[key], valid)}
            hideListError={hideListError}
          />
        ))}
      </div>
    </div>
  );
};
