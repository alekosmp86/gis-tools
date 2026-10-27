"use client";

import React from "react";
import type { ResolvedColumn, TableListing } from "@/core/types/tableCatalog";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { TableSelector } from "@/ui-kit/components/TableSelector";
import { AlertType } from "@/ui-kit/types/ui";
import { ActualizarTableKey, schemaFieldOf, type SchemaField } from "../actualizarPadronTables";
import { SchemaDraftField } from "./SchemaDraftField";
import styles from "./WizardSteps.module.css";

const CATALOG_ERROR_MESSAGE = "No se pudo consultar la base. Revise servidor, puerto, usuario y contraseña en el paso 1.";
const STAGING_SCHEMA_LABEL = "Esquema de origen";
const WORK_SCHEMA_LABEL = "Esquema de trabajo";
const CARTO_SCHEMA_LABEL = "Esquema de carto";
const SCHEMA_HINT =
  "El esquema de origen contiene la tabla de staging. El de trabajo contiene la tabla de trabajo. El de carto contiene padrón, provincias, localidades y, si se elige, tipos de unidad.";

const SELECTORS: ReadonlyArray<{ key: ActualizarTableKey; label: string }> = [
  { key: ActualizarTableKey.STAGING, label: "Tabla de origen" },
  { key: ActualizarTableKey.WORK, label: "Tabla de trabajo" },
  { key: ActualizarTableKey.PADRON, label: "Tabla padrón" },
  { key: ActualizarTableKey.PROVINCE, label: "Tabla de provincias" },
  { key: ActualizarTableKey.LOCALITY, label: "Tabla de localidades" },
  { key: ActualizarTableKey.TYPE, label: "Tabla de tipos de unidad (opcional)" },
];

const isBlank = (value: string): boolean => value.trim() === "";

export interface ActualizarTablesStepProps {
  stagingSchema: string;
  workSchema: string;
  cartoSchema: string;
  tables: Record<ActualizarTableKey, string>;
  excluded: Record<ActualizarTableKey, string[]>;
  onSchemaChange: (field: SchemaField, schema: string) => void;
  onTableChange: (key: ActualizarTableKey, table: string, valid: boolean) => void;
  loadTables: (schema: string) => Promise<TableListing>;
  checkColumns: (key: ActualizarTableKey, table: string) => Promise<ResolvedColumn[]>;
  blockingReason: string | null;
  catalogError: string | null;
}

/** TableSelector re-checks columns only when its own value changes, so the locality selector is remounted when the type table changes. */
const selectorKeyOf = (key: ActualizarTableKey, tables: Record<ActualizarTableKey, string>): string =>
  key === ActualizarTableKey.LOCALITY ? `${key}:${tables[ActualizarTableKey.TYPE]}` : key;

export const ActualizarTablesStep: React.FC<ActualizarTablesStepProps> = ({
  stagingSchema,
  workSchema,
  cartoSchema,
  tables,
  excluded,
  onSchemaChange,
  onTableChange,
  loadTables,
  checkColumns,
  blockingReason,
  catalogError,
}) => {
  const schemas: Record<SchemaField, string> = { stagingSchema, workSchema, cartoSchema };
  const schemaOf = (key: ActualizarTableKey): string => schemas[schemaFieldOf(key)];

  return (
    <div className={styles.stack}>
      <div className={styles.schemaBlock}>
        <div className={styles.schemaPair}>
          <SchemaDraftField
            label={STAGING_SCHEMA_LABEL}
            initial={stagingSchema}
            committed={stagingSchema}
            onCommit={(schema) => onSchemaChange("stagingSchema", schema)}
          />
          <SchemaDraftField
            label={WORK_SCHEMA_LABEL}
            initial={workSchema}
            committed={workSchema}
            onCommit={(schema) => onSchemaChange("workSchema", schema)}
          />
          <SchemaDraftField
            label={CARTO_SCHEMA_LABEL}
            initial={cartoSchema}
            committed={cartoSchema}
            onCommit={(schema) => onSchemaChange("cartoSchema", schema)}
          />
        </div>
        <p className={styles.schemaHint}>{SCHEMA_HINT}</p>
      </div>

      <div className={styles.tablesGrid}>
        {SELECTORS.map(({ key, label }) => (
          <TableSelector
            key={selectorKeyOf(key, tables)}
            label={label}
            schema={schemaOf(key)}
            value={tables[key]}
            onChange={(table) => onTableChange(key, table, false)}
            loadTables={loadTables}
            checkColumns={(table) => checkColumns(key, table)}
            disabled={isBlank(schemaOf(key))}
            excludedTables={excluded[key]}
            onValidityChange={(valid) => onTableChange(key, tables[key], valid)}
            hideListError={catalogError !== null}
          />
        ))}
      </div>

      {catalogError !== null && (
        <div role="alert">
          <AlertMessage type={AlertType.ERROR} text={`${CATALOG_ERROR_MESSAGE} ${catalogError}`} />
        </div>
      )}
      {blockingReason !== null && <AlertMessage type={AlertType.WARNING} text={blockingReason} />}
    </div>
  );
};
