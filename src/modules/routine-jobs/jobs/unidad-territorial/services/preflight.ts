// fallow-ignore-file duplicate-export
import type { CatalogQuerySession } from "@/core/services/server/tableCatalog/tableCatalog";
import { physicalColumn, qualifiedName, type TableLayout } from "../../actualizar-padron/domain/layouts";
import { addressMasterIssuesOf } from "../../shared/addressMasterLinkPreflight";
import { labelOf } from "../../shared/targetPreflight";
import { assertWriteTargetsReady, throwIfIssues, type SourceTablesSpec, type WriteTargetsSpec } from "../../shared/preflightAsserts";
import { UNIT_SOURCE_COLUMN, UNIT_TARGET_TITLE, UNIT_TARGET_WRITTEN_COLUMNS, UNIT_TYPE_COLUMN } from "../constants";
import type { UnitLayouts } from "../types";

export const CONFIRM_REQUIRED_MESSAGE =
  "Confirme la actualización de unidades territoriales para escribir en la tabla de destino. Sin confirmación solo se permite el análisis sin cargar.";

export async function resolveUnitTypeId(
  session: CatalogQuerySession,
  type: TableLayout,
  typeName: string
): Promise<number> {
  const label = labelOf(type);
  const result = await session.query(
    `SELECT count(*) AS "matches", min(${physicalColumn(type, UNIT_TYPE_COLUMN.ID)}) AS "id" FROM ${qualifiedName(type)} WHERE ${physicalColumn(type, UNIT_TYPE_COLUMN.NAME)} = $1`,
    [typeName]
  );
  const matches = Number(result.rows[0]?.matches ?? 0);
  if (matches !== 1) {
    throw new Error(
      `El tipo "${typeName}" aparece ${matches} veces en ${label}: debe aparecer exactamente una vez.`
    );
  }
  const unitTypeId = Number(result.rows[0]?.id);
  if (!Number.isSafeInteger(unitTypeId)) {
    throw new Error(`El id del tipo "${typeName}" en ${label} no es un entero válido.`);
  }
  return unitTypeId;
}

const writeTargetsSpecOf = (layouts: UnitLayouts): WriteTargetsSpec => ({
  targets: [layouts.target],
  writtenColumns: UNIT_TARGET_WRITTEN_COLUMNS,
  title: UNIT_TARGET_TITLE,
  readTables: [layouts.locality, layouts.type],
});

export const sourceTablesSpecOf = (layouts: UnitLayouts): SourceTablesSpec => ({
  withRows: [{ layout: layouts.locality, description: "localidades" }],
  geometry: { layout: layouts.locality, column: UNIT_SOURCE_COLUMN.GEOMETRY },
});

export async function assertUnitTargetsReady(session: CatalogQuerySession, layouts: UnitLayouts): Promise<void> {
  await assertWriteTargetsReady(session, writeTargetsSpecOf(layouts));
  if (layouts.addressMaster !== undefined) {
    throwIfIssues(await addressMasterIssuesOf(session, layouts.addressMaster));
  }
}
