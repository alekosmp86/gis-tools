import type { CatalogQuerySession } from "@/core/services/server/tableCatalog/tableCatalog";
import { addressMasterIssuesOf } from "../../shared/addressMasterLinkPreflight";
import { labelOf } from "../../shared/targetPreflight";
import type { WritableTargetLayout } from "../../shared/tableResolution";
import { DESTINATION_COLUMN } from "../constants";
import { buildKeyFormatSql, isTextDataType, keyFormatIssue, numberTypeIssue, type KeyFormatExample } from "../domain/keyFormat";
import { buildLocalityTypeMatchSql } from "../domain/localityTypeSql";
import { buildLocalityReferenceSql } from "../domain/localityReferenceSql";
import { localityReferenceVerdict, type LocalityReferenceVerdict } from "../domain/localityReference";
import type { TableLayout } from "../domain/layouts";
import type { PadronLayouts } from "../types";

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

export async function keyFormatIssuesOf(session: CatalogQuerySession, target: WritableTargetLayout): Promise<string[]> {
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

export async function addressMasterIssuesFor(session: CatalogQuerySession, layouts: PadronLayouts): Promise<string[]> {
  return layouts.addressMaster === undefined ? [] : addressMasterIssuesOf(session, layouts.addressMaster);
}

export async function localityReferenceVerdictOf(session: CatalogQuerySession, layouts: PadronLayouts): Promise<LocalityReferenceVerdict> {
  const result = await session.query(buildLocalityReferenceSql(layouts.target, layouts.locality));
  const row = result.rows[0];
  return localityReferenceVerdict(
    { total: Number(row?.total ?? 0), unresolved: Number(row?.unresolved ?? 0) },
    labelOf(layouts.target),
    labelOf(layouts.locality)
  );
}
