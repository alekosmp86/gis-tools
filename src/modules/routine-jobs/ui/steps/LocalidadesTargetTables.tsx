"use client";

import React from "react";
import { Plus, Trash2 } from "lucide-react";
import type { ResolvedColumn, TableListing } from "@/core/types/tableCatalog";
import { Button } from "@/ui-kit/components/ui/Button";
import { TableSelector } from "@/ui-kit/components/TableSelector";
import { ButtonVariant } from "@/ui-kit/types/ui";
import { LOCALIDADES_TABLE_ROLE, MAX_TARGETS, type LocalidadesTableRole } from "../../jobs/cargar-localidades/constants";
import type { LocalidadesTargetDraft } from "../cargarLocalidadesWizardState";
import { SchemaDraftField } from "./SchemaDraftField";
import styles from "./WizardSteps.module.css";

const ADD_LABEL = "Añadir tabla destino";
const REMOVE_LABEL = "Quitar";
const TARGET_TITLE = (position: number): string => `Destino ${position}`;
const SCHEMA_LABEL = (position: number): string => `Esquema del destino ${position}`;
const TABLE_LABEL = (position: number): string => `Tabla de localidades destino ${position}`;
const TARGETS_HINT = `Cada tabla destino recibe la misma carga, en la misma transacción. Puede elegir hasta ${MAX_TARGETS}.`;

const isBlank = (value: string): boolean => value.trim() === "";

export interface LocalidadesTargetTablesProps {
  targets: LocalidadesTargetDraft[];
  excluded: string[][];
  onSchemaChange: (index: number, schema: string) => void;
  onTableChange: (index: number, table: string, valid: boolean) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
  loadTables: (schema: string) => Promise<TableListing>;
  checkColumns: (role: LocalidadesTableRole, schema: string, table: string) => Promise<ResolvedColumn[]>;
  hideListError: boolean;
}

interface TargetRowProps extends Omit<LocalidadesTargetTablesProps, "targets" | "excluded" | "onAdd"> {
  target: LocalidadesTargetDraft;
  index: number;
  excludedNames: string[];
  canRemove: boolean;
}

const TargetRow: React.FC<TargetRowProps> = ({
  target,
  index,
  excludedNames,
  canRemove,
  onSchemaChange,
  onTableChange,
  onRemove,
  loadTables,
  checkColumns,
  hideListError,
}) => {
  const position = index + 1;
  return (
    <div className={styles.stack}>
      <div className={styles.schemaPair}>
        <SchemaDraftField
          label={SCHEMA_LABEL(position)}
          initial={target.schema}
          committed={target.schema}
          onCommit={(schema) => onSchemaChange(index, schema)}
        />
      </div>
      <div className={styles.tablesGrid}>
        <TableSelector
          label={TABLE_LABEL(position)}
          schema={target.schema}
          value={target.table}
          onChange={(table) => onTableChange(index, table, false)}
          loadTables={loadTables}
          checkColumns={(table) => checkColumns(LOCALIDADES_TABLE_ROLE.TARGET, target.schema.trim(), table)}
          disabled={isBlank(target.schema)}
          excludedTables={excludedNames}
          onValidityChange={(valid) => onTableChange(index, target.table, valid)}
          hideListError={hideListError}
        />
      </div>
      {canRemove && (
        <div className={styles.actions}>
          <Button variant={ButtonVariant.GHOST} onClick={() => onRemove(index)}>
            <Trash2 size={15} />
            <span>{REMOVE_LABEL}</span>
          </Button>
        </div>
      )}
    </div>
  );
};

export const LocalidadesTargetTables: React.FC<LocalidadesTargetTablesProps> = ({
  targets,
  excluded,
  onSchemaChange,
  onTableChange,
  onAdd,
  onRemove,
  loadTables,
  checkColumns,
  hideListError,
}) => (
  <section className={styles.stack}>
    {targets.map((target, index) => (
      <React.Fragment key={target.key}>
        <h4 className={styles.hint}>{TARGET_TITLE(index + 1)}</h4>
        <TargetRow
          target={target}
          index={index}
          excludedNames={excluded[index] ?? []}
          canRemove={targets.length > 1}
          onSchemaChange={onSchemaChange}
          onTableChange={onTableChange}
          onRemove={onRemove}
          loadTables={loadTables}
          checkColumns={checkColumns}
          hideListError={hideListError}
        />
      </React.Fragment>
    ))}
    <p className={styles.hint}>{TARGETS_HINT}</p>
    {targets.length < MAX_TARGETS && (
      <div className={styles.actions}>
        <Button variant={ButtonVariant.SECONDARY} onClick={onAdd}>
          <Plus size={15} />
          <span>{ADD_LABEL}</span>
        </Button>
      </div>
    )}
  </section>
);
