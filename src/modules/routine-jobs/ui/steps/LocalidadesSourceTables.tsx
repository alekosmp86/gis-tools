"use client";

import React from "react";
import type { ResolvedColumn, TableListing } from "@/core/types/tableCatalog";
import { TableSelector } from "@/ui-kit/components/TableSelector";
import { LOCALIDADES_TABLE_ROLE, type LocalidadesTableRole } from "../../jobs/cargar-localidades/constants";
import { FixedTable } from "../cargarLocalidadesWizardState";
import { SchemaTableCard } from "../SchemaTableCard";
import { SchemaTableSection } from "../SchemaTableSection";
import { SchemaDraftField } from "./SchemaDraftField";

const ORIGIN_TITLE = "Origen";
const ORIGIN_SCHEMA_LABEL = "Esquema de origen";
const SCHEMA_LABEL = "Esquema";

interface SourceCopy {
  key: FixedTable;
  role: LocalidadesTableRole;
  title: string;
  note: string;
  tableLabel: string;
}

const ORIGIN_CARDS: readonly SourceCopy[] = [
  {
    key: FixedTable.PADRON,
    role: LOCALIDADES_TABLE_ROLE.STAGING_PADRON,
    title: "Padrones urbanos cargados",
    note: "Solo se usa para saber qué localidades existen.",
    tableLabel: "Tabla de padrones",
  },
  {
    key: FixedTable.LOCALITY,
    role: LOCALIDADES_TABLE_ROLE.STAGING_LOCALIDAD,
    title: "Localidades de origen",
    note: "Aporta el nombre, el departamento y la geometría de cada localidad.",
    tableLabel: "Tabla de localidades de origen",
  },
];

const PROVINCE_CARD: SourceCopy = {
  key: FixedTable.PROVINCE,
  role: LOCALIDADES_TABLE_ROLE.PROVINCE,
  title: "Provincias",
  note: "Se usa para asociar cada departamento con su provincia.",
  tableLabel: "Tabla de provincias",
};

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
  const selectorOf = ({ key, role, tableLabel }: SourceCopy) => (
    <TableSelector
      label={tableLabel}
      schema={schemaOf(key)}
      value={tables[key]}
      onChange={(table) => onTableChange(key, table, false)}
      loadTables={loadTables}
      checkColumns={(table) => checkColumns(role, schemaOf(key).trim(), table)}
      disabled={isBlank(schemaOf(key))}
      excludedTables={excluded[key]}
      onValidityChange={(valid) => onTableChange(key, tables[key], valid)}
      hideListError={hideListError}
      bare
    />
  );
  return (
    <>
      <SchemaTableSection
        title={ORIGIN_TITLE}
        headerField={
          <SchemaDraftField
            label={ORIGIN_SCHEMA_LABEL}
            initial={stagingSchema}
            committed={stagingSchema}
            onCommit={onStagingSchemaChange}
          />
        }
      >
        {ORIGIN_CARDS.map((copy) => (
          <SchemaTableCard key={copy.key} title={copy.title} note={copy.note} table={selectorOf(copy)} />
        ))}
      </SchemaTableSection>
      <SchemaTableSection>
        <SchemaTableCard
          title={PROVINCE_CARD.title}
          note={PROVINCE_CARD.note}
          schema={
            <SchemaDraftField
              label={SCHEMA_LABEL}
              initial={provinceSchema}
              committed={provinceSchema}
              onCommit={onProvinceSchemaChange}
            />
          }
          table={selectorOf(PROVINCE_CARD)}
        />
      </SchemaTableSection>
    </>
  );
};
