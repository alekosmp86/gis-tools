/**
 * nullRecordHandler.ts
 * Procesamiento y generación de ítems de discrepancia para registros con SUIDs nulos o vacíos.
 */

import type { AttributeDifference, DiscrepancyItem } from "@/types/comparison";
import { DiscrepancyType } from "@/types/comparison";
import { cleanValue } from "./suidKeyUtils";

export function extractNullRecordInfo(
  record: Record<string, unknown>,
  isDbRecord: boolean,
  fieldsToCompare: string[],
  fieldToFileKey?: Map<string, string | null>
): { differences: AttributeDifference[]; note: string } {
  const differences: AttributeDifference[] = [];
  const addedFields = new Set<string>();
  const summaryParts: string[] = [];

  fieldsToCompare.forEach((field) => {
    let fileKey: string | null | undefined = field;
    if (!isDbRecord && fieldToFileKey) {
      fileKey = fieldToFileKey.get(field);
    }
    const val = isDbRecord ? record[field] : fileKey ? record[fileKey] : record[field];
    if (val !== undefined && val !== null && cleanValue(val) !== "") {
      differences.push({
        fieldName: field,
        dbValue: isDbRecord ? (val as string | number | null) : null,
        shpValue: isDbRecord ? null : (val as string | number | null),
      });
      addedFields.add(field.toLowerCase());
      if (summaryParts.length < 3) {
        summaryParts.push(`${field}: ${String(val)}`);
      }
    }
  });

  Object.entries(record).forEach(([key, val]) => {
    const keyLower = key.toLowerCase();
    if (addedFields.has(keyLower)) return;
    if (["geom", "geometry", "wkb_geometry", "shape_leng", "shape_area"].includes(keyLower)) return;

    const isIdentifierKey =
      /\bid\b/.test(keyLower) ||
      keyLower.endsWith("_id") ||
      keyLower.endsWith("_cod") ||
      keyLower.startsWith("cod") ||
      keyLower.startsWith("nom") ||
      keyLower.includes("name") ||
      keyLower.includes("ref") ||
      keyLower.startsWith("num");

    if (isIdentifierKey && val !== undefined && val !== null && cleanValue(val) !== "") {
      differences.push({
        fieldName: key,
        dbValue: isDbRecord ? (val as string | number | null) : null,
        shpValue: isDbRecord ? null : (val as string | number | null),
      });
      addedFields.add(keyLower);
      if (summaryParts.length < 3) {
        summaryParts.push(`${key}: ${String(val)}`);
      }
    }
  });

  if (differences.length === 0) {
    Object.entries(record).forEach(([key, val]) => {
      if (addedFields.size >= 5) return;
      const keyLower = key.toLowerCase();
      if (["geom", "geometry", "wkb_geometry", "shape_leng", "shape_area"].includes(keyLower)) return;
      if (val !== undefined && val !== null && cleanValue(val) !== "") {
        differences.push({
          fieldName: key,
          dbValue: isDbRecord ? (val as string | number | null) : null,
          shpValue: isDbRecord ? null : (val as string | number | null),
        });
        addedFields.add(keyLower);
        if (summaryParts.length < 3) {
          summaryParts.push(`${key}: ${String(val)}`);
        }
      }
    });
  }

  const originText = isDbRecord ? "base de datos" : "archivo fuente";
  let note = `Registro en ${originText} sin clave identificadora SUID completa.`;
  if (summaryParts.length > 0) {
    note += ` [Atributos: ${summaryParts.join(" | ")}]`;
  }

  return { differences, note };
}

export function createNullDiscrepancyItem(
  id: string,
  record: Record<string, unknown>,
  isDbRecord: boolean,
  fieldsToCompare: string[],
  fieldToFileKey?: Map<string, string | null>
): DiscrepancyItem {
  const { differences, note } = extractNullRecordInfo(
    record,
    isDbRecord,
    fieldsToCompare,
    fieldToFileKey
  );

  return {
    id,
    suid: isDbRecord ? "(SUID NULL / Vacío en DB)" : "(SUID NULL / Vacío en Archivo)",
    type: DiscrepancyType.NULL_SUID,
    differences,
    dbRecord: isDbRecord ? record : undefined,
    shpFeatureProps: isDbRecord ? undefined : record,
    note,
  };
}
