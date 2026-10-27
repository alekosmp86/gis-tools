"use client";

import React from "react";
import type { ResolvedColumn, TableListing } from "@/core/types/tableCatalog";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { TableSelector } from "@/ui-kit/components/TableSelector";
import { AlertType } from "@/ui-kit/types/ui";
import { UNIT_TABLE_ROLE, type UnitTableRole } from "../../jobs/unidad-territorial/constants";
import { UnitSlot, type UnitSlotDraft } from "../unidadTerritorialWizardState";
import { SchemaTableCard } from "../SchemaTableCard";
import { SchemaTableSection } from "../SchemaTableSection";
import { SchemaDraftField } from "./SchemaDraftField";
import styles from "./WizardSteps.module.css";

const CATALOG_ERROR_MESSAGE = "No se pudo consultar la base. Revise la conexión.";
const SCHEMA_LABEL = "Esquema";

interface SlotCopy {
  key: UnitSlot;
  role: UnitTableRole;
  title: string;
  note: string;
  tableLabel: string;
}

const SLOTS: readonly SlotCopy[] = [
  {
    key: UnitSlot.LOCALITY,
    role: UNIT_TABLE_ROLE.SOURCE,
    title: "Localidades de origen",
    note: "Se copian a unidades territoriales.",
    tableLabel: "Tabla de localidades catastrales (origen)",
  },
  {
    key: UnitSlot.TARGET,
    role: UNIT_TABLE_ROLE.TARGET,
    title: "Unidades territoriales (destino)",
    note: "Tabla donde se escriben las unidades territoriales.",
    tableLabel: "Tabla de unidades territoriales (destino)",
  },
  {
    key: UnitSlot.TYPE,
    role: UNIT_TABLE_ROLE.TYPE,
    title: "Tipos de unidad",
    note: "Asigna el tipo de cada unidad territorial.",
    tableLabel: "Tabla de tipos de unidad territorial",
  },
];

export interface UnidadTablesStepProps {
  slots: Record<UnitSlot, UnitSlotDraft>;
  excluded: Record<UnitSlot, string[]>;
  onSchemaChange: (key: UnitSlot, schema: string) => void;
  onTableChange: (key: UnitSlot, table: string, valid: boolean) => void;
  loadTables: (schema: string) => Promise<TableListing>;
  checkColumns: (role: UnitTableRole, schema: string, table: string) => Promise<ResolvedColumn[]>;
  blockingReason: string | null;
  catalogError: string | null;
}

const isBlank = (value: string): boolean => value.trim() === "";

export const UnidadTablesStep: React.FC<UnidadTablesStepProps> = ({
  slots,
  excluded,
  onSchemaChange,
  onTableChange,
  loadTables,
  checkColumns,
  blockingReason,
  catalogError,
}) => (
  <div className={styles.stack}>
    <SchemaTableSection>
      {SLOTS.map(({ key, role, title, note, tableLabel }) => {
        const slot = slots[key];
        return (
          <SchemaTableCard
            key={key}
            title={title}
            note={note}
            schema={
              <SchemaDraftField
                label={SCHEMA_LABEL}
                initial={slot.schema}
                committed={slot.schema}
                onCommit={(schema) => onSchemaChange(key, schema)}
              />
            }
            table={
              <TableSelector
                label={tableLabel}
                schema={slot.schema}
                value={slot.table}
                onChange={(table) => onTableChange(key, table, false)}
                loadTables={loadTables}
                checkColumns={(table) => checkColumns(role, slot.schema.trim(), table)}
                disabled={isBlank(slot.schema)}
                excludedTables={excluded[key]}
                onValidityChange={(valid) => onTableChange(key, slot.table, valid)}
                hideListError={catalogError !== null}
                bare
              />
            }
          />
        );
      })}
    </SchemaTableSection>
    {catalogError !== null && (
      <div role="alert">
        <AlertMessage type={AlertType.ERROR} text={`${CATALOG_ERROR_MESSAGE} ${catalogError}`} />
      </div>
    )}
    {blockingReason !== null && <AlertMessage type={AlertType.WARNING} text={blockingReason} />}
  </div>
);
