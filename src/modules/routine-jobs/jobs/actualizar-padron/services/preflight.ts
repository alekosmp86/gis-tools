import type { CatalogQuerySession } from "@/core/services/server/tableCatalog/tableCatalog";
import { addressMasterIssuesOf } from "../../shared/addressMasterLinkPreflight";
import { labelOf } from "../../shared/targetPreflight";
import { assertWriteTargetsReady, throwIfIssues, type SourceTablesSpec, type WriteTargetsSpec } from "../../shared/preflightAsserts";
import type { WritableTargetLayout } from "../../shared/tableResolution";
import { STAGING_COLUMN, DESTINATION_COLUMN, DESTINATION_TITLE, DESTINATION_WRITTEN_COLUMNS } from "../constants";
import { buildKeyFormatSql, isTextDataType, keyFormatIssue, numberTypeIssue, type KeyFormatExample } from "../domain/keyFormat";
import { buildLocalityTypeMatchSql } from "../domain/localityTypeSql";
import { buildLocalityReferenceSql } from "../domain/localityReferenceSql";
import { localityReferenceVerdict, type LocalityReferenceVerdict } from "../domain/localityReference";
import type { TableLayout } from "../domain/layouts";
import type { PadronLayouts } from "../types";

export const CONFIRM_REQUIRED_MESSAGE =
  "Confirme la actualización de padrones para escribir en la tabla de destino. Sin confirmación solo se permite el análisis sin cargar.";

export async function resolveLocalityTypeId(session: CatalogQuerySession, type: TableLayout, localityType: string): Promise<number> {
  const result = await session.query(buildLocalityTypeMatchSql(type), [localityType]);
  const matches = Number(result.rows[0]?.matches ?? 0);
  if (matches !== 1) {
    throw new Error(
      `El tipo de localidad "${localityType}" aparece ${matches} veces en ${labelOf(type)}: debe aparecer exactamente una vez.`
    );
  }
  const typeId = Number(result.rows[0]?.id);
  if (!Number.isSafeInteger(typeId)) {
    throw new Error(`El id del tipo de localidad "${localityType}" en ${labelOf(type)} no es un entero válido.`);
  }
  return typeId;
}

const writeTargetsSpecOf = (layouts: PadronLayouts): WriteTargetsSpec => ({
  targets: [layouts.target],
  writtenColumns: DESTINATION_WRITTEN_COLUMNS,
  title: DESTINATION_TITLE,
  readTables: [layouts.staging, layouts.province, layouts.locality, ...(layouts.type ? [layouts.type] : [])],
});

export const sourceTablesSpecOf = (layouts: PadronLayouts): SourceTablesSpec => ({
  withRows: [{ layout: layouts.staging, description: "padrones" }],
  geometry: { layout: layouts.staging, column: STAGING_COLUMN.GEOM },
});

async function keyFormatIssuesOf(session: CatalogQuerySession, target: WritableTargetLayout): Promise<string[]> {
  const label = labelOf(target);
  const numberColumn = target.columns[DESTINATION_COLUMN.NUMBER];
  const numberType = target.catalog.find((entry) => entry.column_name === numberColumn)?.data_type;
  const typeIssues =
    numberType === undefined || isTextDataType(numberType) ? [] : [numberTypeIssue(label, numberColumn, numberType)];
  const result = await session.query(buildKeyFormatSql(target, typeIssues.length === 0));
  const row = result.rows[0];
  const bad = Number(row?.bad ?? 0);
  return bad === 0 ? typeIssues : [...typeIssues, keyFormatIssue(label, bad, row?.example as KeyFormatExample)];
}

async function addressMasterIssuesFor(session: CatalogQuerySession, layouts: PadronLayouts): Promise<string[]> {
  return layouts.addressMaster === undefined ? [] : addressMasterIssuesOf(session, layouts.addressMaster);
}

async function localityReferenceVerdictOf(session: CatalogQuerySession, layouts: PadronLayouts): Promise<LocalityReferenceVerdict> {
  const result = await session.query(buildLocalityReferenceSql(layouts.target, layouts.locality));
  const row = result.rows[0];
  return localityReferenceVerdict(
    { total: Number(row?.total ?? 0), unresolved: Number(row?.unresolved ?? 0) },
    labelOf(layouts.target),
    labelOf(layouts.locality)
  );
}

export async function assertTargetReady(session: CatalogQuerySession, layouts: PadronLayouts): Promise<string[]> {
  await assertWriteTargetsReady(session, writeTargetsSpecOf(layouts));
  throwIfIssues(await keyFormatIssuesOf(session, layouts.target));
  const localityVerdict = await localityReferenceVerdictOf(session, layouts);
  throwIfIssues(localityVerdict.kind === "refuse" ? [localityVerdict.message] : []);
  throwIfIssues(await addressMasterIssuesFor(session, layouts));
  return localityVerdict.kind === "warn" ? [localityVerdict.warning] : [];
}
