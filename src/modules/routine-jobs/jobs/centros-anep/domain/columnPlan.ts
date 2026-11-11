import type { DbColumnMetadata } from "@/core/types/db";
import { sequenceReferenceOf } from "../../actualizar-padron/domain/sequenceReference";
import { plural } from "../../shared/text";
import { CENTROS_TEXT_TYPE_PATTERN } from "../constants";
import type { CentrosColumnPair, CentrosColumnPlan, CentrosTypeMismatch } from "../types";

export interface ColumnPlanInput {
  stagingCatalog: readonly DbColumnMetadata[];
  finalCatalog: readonly DbColumnMetadata[];
  stagingGeometry: string;
  finalGeometry: string;
  identityColumns: readonly string[];
}

const entryNamed = (catalog: readonly DbColumnMetadata[], name: string): DbColumnMetadata | undefined =>
  catalog.find((entry) => entry.column_name === name);

export const isDefaultFilled = (entry: DbColumnMetadata, identityColumns: readonly string[]): boolean =>
  identityColumns.includes(entry.column_name) || sequenceReferenceOf(entry.column_default) !== undefined;

export const textColumnsOf = (catalog: readonly DbColumnMetadata[]): string[] =>
  catalog.filter((entry) => CENTROS_TEXT_TYPE_PATTERN.test(entry.data_type.trim())).map((entry) => entry.column_name);

export function planColumns(input: ColumnPlanInput): CentrosColumnPlan {
  const { stagingCatalog, finalCatalog, stagingGeometry, finalGeometry, identityColumns } = input;
  const pairs: CentrosColumnPair[] = [{ source: stagingGeometry, target: finalGeometry, isGeometry: true }];
  const skippedDefaults: string[] = [];
  const missingInFinal: string[] = [];
  const typeMismatches: CentrosTypeMismatch[] = [];
  for (const staged of stagingCatalog) {
    if (staged.column_name === stagingGeometry) continue;
    const counterpart = entryNamed(finalCatalog, staged.column_name);
    if (counterpart === undefined) {
      missingInFinal.push(staged.column_name);
    } else if (isDefaultFilled(counterpart, identityColumns)) {
      skippedDefaults.push(counterpart.column_name);
    } else {
      pairs.push({ source: staged.column_name, target: counterpart.column_name, isGeometry: false });
      if (staged.data_type !== counterpart.data_type) {
        typeMismatches.push({ column: staged.column_name, stagingType: staged.data_type, finalType: counterpart.data_type });
      }
    }
  }
  const targetNames = new Set(pairs.map((pair) => pair.target));
  const skipped = new Set(skippedDefaults);
  const unfilled = finalCatalog.filter(
    (entry) => !targetNames.has(entry.column_name) && !skipped.has(entry.column_name) && !isDefaultFilled(entry, identityColumns)
  );
  return {
    pairs,
    skippedDefaults,
    missingInFinal,
    missingInStaging: unfilled.map((entry) => entry.column_name),
    typeMismatches,
    requiredWithoutValue: unfilled
      .filter((entry) => !entry.is_nullable && !entry.column_default)
      .map((entry) => entry.column_name),
  };
}

const namesText = (names: readonly string[]): string => names.map((name) => `"${name}"`).join(", ");

export function columnPlanBlockers(plan: CentrosColumnPlan, finalLabel: string, stagingLabel: string): string[] {
  const blockers: string[] = [];
  if (plan.missingInFinal.length > 0) {
    blockers.push(
      `${plural(plan.missingInFinal.length, "columna de staging no existe", "columnas de staging no existen")} en ${finalLabel}: ${namesText(plan.missingInFinal)}.`
    );
  }
  for (const mismatch of plan.typeMismatches) {
    blockers.push(
      `La columna "${mismatch.column}" tiene tipo ${mismatch.stagingType} en ${stagingLabel} y ${mismatch.finalType} en ${finalLabel}: deben coincidir.`
    );
  }
  if (plan.requiredWithoutValue.length > 0) {
    blockers.push(
      `Columnas de ${finalLabel} NOT NULL sin valor por defecto que no existen en staging: ${namesText(plan.requiredWithoutValue)}.`
    );
  }
  return blockers;
}

export const columnInfoOf = (plan: CentrosColumnPlan, finalLabel: string): string[] =>
  plan.missingInStaging.length === 0
    ? []
    : [`Columnas de ${finalLabel} que no existen en staging y quedan con su valor por defecto o nulas: ${namesText(plan.missingInStaging)}.`];
