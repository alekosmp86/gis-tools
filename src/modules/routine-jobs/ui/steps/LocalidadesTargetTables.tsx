"use client";

import React from "react";
import type { ResolvedColumn, TableListing } from "@/core/types/tableCatalog";
import { TableSelector } from "@/ui-kit/components/TableSelector";
import { LOCALIDADES_TABLE_ROLE, type LocalidadesTableRole } from "../../jobs/cargar-localidades/constants";
import {
  DESTINATION_ORDER,
  DESTINATION_TITLE,
  type LocalidadesDestination,
  type LocalidadesTargetDraft,
} from "../cargarLocalidadesWizardState";
import { SchemaTableCard } from "../SchemaTableCard";
import { SchemaTableSection } from "../SchemaTableSection";
import { SchemaDraftField } from "./SchemaDraftField";
import styles from "./WizardSteps.module.css";

const TARGETS_TITLE = "Destinos";
const TARGETS_NOTE = "Elija al menos uno. Cada destino incluido recibe la misma carga, en la misma transacción.";
const CARD_NOTE = "Tabla donde se escriben las localidades.";
const EXCLUDED_NOTE = "Este destino no se envía en la carga.";
const INCLUDE_LABEL = "Incluir este destino";
const SCHEMA_LABEL = "Esquema";
const TABLE_LABEL = "Tabla de localidades";

export interface LocalidadesTargetTablesProps {
  targets: Record<LocalidadesDestination, LocalidadesTargetDraft>;
  excluded: Record<LocalidadesDestination, string[]>;
  onSchemaChange: (destination: LocalidadesDestination, schema: string) => void;
  onTableChange: (destination: LocalidadesDestination, table: string, valid: boolean) => void;
  onIncludedChange: (destination: LocalidadesDestination, included: boolean) => void;
  loadTables: (schema: string) => Promise<TableListing>;
  checkColumns: (role: LocalidadesTableRole, schema: string, table: string) => Promise<ResolvedColumn[]>;
  hideListError: boolean;
}

interface DestinationCardProps extends Omit<LocalidadesTargetTablesProps, "targets" | "excluded"> {
  destination: LocalidadesDestination;
  target: LocalidadesTargetDraft;
  excludedNames: string[];
}

const DestinationCard: React.FC<DestinationCardProps> = ({
  destination,
  target,
  excludedNames,
  onSchemaChange,
  onTableChange,
  onIncludedChange,
  loadTables,
  checkColumns,
  hideListError,
}) => (
  <SchemaTableCard
    title={DESTINATION_TITLE[destination]}
    note={CARD_NOTE}
    headerAction={
      <label className={styles.checkRow}>
        <input
          type="checkbox"
          checked={target.included}
          onChange={(event) => onIncludedChange(destination, event.target.checked)}
        />
        <span>{INCLUDE_LABEL}</span>
      </label>
    }
    schema={
      target.included ? (
        <SchemaDraftField
          label={SCHEMA_LABEL}
          initial={target.schema}
          committed={target.schema}
          onCommit={(schema) => onSchemaChange(destination, schema)}
        />
      ) : undefined
    }
    table={
      target.included ? (
        <TableSelector
          label={TABLE_LABEL}
          schema={target.schema}
          value={target.table}
          onChange={(table) => onTableChange(destination, table, false)}
          loadTables={loadTables}
          checkColumns={(table) => checkColumns(LOCALIDADES_TABLE_ROLE.TARGET, target.schema.trim(), table)}
          disabled={target.schema.trim() === ""}
          excludedTables={excludedNames}
          onValidityChange={(valid) => onTableChange(destination, target.table, valid)}
          hideListError={hideListError}
          bare
        />
      ) : (
        <p className={styles.hint}>{EXCLUDED_NOTE}</p>
      )
    }
  />
);

export const LocalidadesTargetTables: React.FC<LocalidadesTargetTablesProps> = ({
  targets,
  excluded,
  onSchemaChange,
  onTableChange,
  onIncludedChange,
  loadTables,
  checkColumns,
  hideListError,
}) => (
  <SchemaTableSection title={TARGETS_TITLE} note={TARGETS_NOTE}>
    {DESTINATION_ORDER.map((destination) => (
      <DestinationCard
        key={destination}
        destination={destination}
        target={targets[destination]}
        excludedNames={excluded[destination]}
        onSchemaChange={onSchemaChange}
        onTableChange={onTableChange}
        onIncludedChange={onIncludedChange}
        loadTables={loadTables}
        checkColumns={checkColumns}
        hideListError={hideListError}
      />
    ))}
  </SchemaTableSection>
);
