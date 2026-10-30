"use client";

import React from "react";
import type { ResolvedColumn, TableListing } from "@/core/types/tableCatalog";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { TableSelector } from "@/ui-kit/components/TableSelector";
import { AlertType } from "@/ui-kit/types/ui";
import { ActualizarTableKey, schemaFieldOf, type SchemaField } from "../actualizarPadronTables";
import { AddressMasterLinkToggle } from "./AddressMasterLinkToggle";
import { SchemaDraftField } from "./SchemaDraftField";
import styles from "./WizardSteps.module.css";

const CATALOG_ERROR_MESSAGE = "No se pudo consultar la base. Revise la conexión.";
const STAGING_SCHEMA_LABEL = "Esquema de origen";
const CARTO_SCHEMA_LABEL = "Esquema de carto";
const SCHEMA_HINT =
  "El esquema de origen contiene la tabla de origen. El de carto contiene la tabla de destino, las provincias, las localidades, y si se elige, los tipos de unidad y las direcciones maestras.";

const TARGET_HINT =
  "Recibe los datos: inserta los padrones nuevos y actualiza las geometrías cambiadas. Nunca borra filas ni cambia ids. Para probar, use una tabla de prueba como padron_tmp_actualizacion.";
const LOCALITY_HINT = "Los padrones referencian unidades territoriales: elija territorial_unit.";
const LINK_LABEL = "Enlazar direcciones maestras de los padrones";
const LINK_HINT =
  "Crea la dirección maestra de cada padrón que no tiene una y la enlaza con el padrón, en la misma transacción. Desactivado por defecto: solo se activa si el padrón debe tener dirección maestra.";
const ADDRESS_MASTER_HINT =
  "Donde se crean los registros de dirección maestra de los padrones. Debe ser distinta de la tabla de destino.";

const SELECTORS: ReadonlyArray<{ key: ActualizarTableKey; label: string; hint?: string }> = [
  { key: ActualizarTableKey.STAGING, label: "Tabla de origen" },
  { key: ActualizarTableKey.TARGET, label: "Tabla de destino", hint: TARGET_HINT },
  { key: ActualizarTableKey.PROVINCE, label: "Tabla de provincias" },
  { key: ActualizarTableKey.LOCALITY, label: "Tabla de localidades", hint: LOCALITY_HINT },
  { key: ActualizarTableKey.TYPE, label: "Tabla de tipos de unidad (opcional)" },
];

const ADDRESS_MASTER_SELECTOR = { key: ActualizarTableKey.ADDRESS_MASTER, label: "Tabla de direcciones maestras", hint: ADDRESS_MASTER_HINT };

const isBlank = (value: string): boolean => value.trim() === "";

export interface ActualizarTablesStepProps {
  stagingSchema: string;
  cartoSchema: string;
  tables: Record<ActualizarTableKey, string>;
  excluded: Record<ActualizarTableKey, string[]>;
  linkAddressMaster: boolean;
  onLinkAddressMasterChange: (linkAddressMaster: boolean) => void;
  onSchemaChange: (field: SchemaField, schema: string) => void;
  onTableChange: (key: ActualizarTableKey, table: string, valid: boolean) => void;
  loadTables: (schema: string) => Promise<TableListing>;
  checkColumns: (key: ActualizarTableKey, table: string) => Promise<ResolvedColumn[]>;
  blockingReason: string | null;
  catalogError: string | null;
}

/** TableSelector re-checks columns only when its own value changes, so the selectors whose role depends on another choice are remounted when it changes. */
const selectorKeyOf = (
  key: ActualizarTableKey,
  tables: Record<ActualizarTableKey, string>,
  linkAddressMaster: boolean
): string => {
  if (key === ActualizarTableKey.LOCALITY) return `${key}:${tables[ActualizarTableKey.TYPE]}`;
  if (key === ActualizarTableKey.TARGET) return `${key}:${linkAddressMaster}`;
  return key;
};

export const ActualizarTablesStep: React.FC<ActualizarTablesStepProps> = ({
  stagingSchema,
  cartoSchema,
  tables,
  excluded,
  linkAddressMaster,
  onLinkAddressMasterChange,
  onSchemaChange,
  onTableChange,
  loadTables,
  checkColumns,
  blockingReason,
  catalogError,
}) => {
  const schemas: Record<SchemaField, string> = { stagingSchema, cartoSchema };
  const schemaOf = (key: ActualizarTableKey): string => schemas[schemaFieldOf(key)];
  const selectors = linkAddressMaster ? [...SELECTORS, ADDRESS_MASTER_SELECTOR] : SELECTORS;

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
            label={CARTO_SCHEMA_LABEL}
            initial={cartoSchema}
            committed={cartoSchema}
            onCommit={(schema) => onSchemaChange("cartoSchema", schema)}
          />
        </div>
        <p className={styles.schemaHint}>{SCHEMA_HINT}</p>
      </div>

      <div className={styles.tablesGrid}>
        {selectors.map(({ key, label, hint }) => (
          <TableSelector
            key={selectorKeyOf(key, tables, linkAddressMaster)}
            label={label}
            hint={hint}
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

      <AddressMasterLinkToggle
        checked={linkAddressMaster}
        onChange={onLinkAddressMasterChange}
        label={LINK_LABEL}
        hint={LINK_HINT}
      />

      {catalogError !== null && (
        <div role="alert">
          <AlertMessage type={AlertType.ERROR} text={`${CATALOG_ERROR_MESSAGE} ${catalogError}`} />
        </div>
      )}
      {blockingReason !== null && <AlertMessage type={AlertType.WARNING} text={blockingReason} />}
    </div>
  );
};
