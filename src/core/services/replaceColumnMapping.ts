import type { DbColumnMetadata } from "@/core/types/db";
import type { InsertFieldDefault } from "@/core/types/comparison";

export interface ReplaceColumnMapping {
  sourceByTarget: Record<string, string | null>;
  defaults: Record<string, InsertFieldDefault>;
}

export interface ReplaceInsertColumn {
  targetColumn: string;
  sourceColumn: string | null;
  fixedDefault: InsertFieldDefault | null;
}

const TypeCategory = {
  NUMERIC: "numeric",
  TEXT: "text",
  BOOLEAN: "boolean",
  TEMPORAL: "temporal",
  GEOMETRY: "geometry",
  OTHER: "other",
} as const;

type TypeCategory = (typeof TypeCategory)[keyof typeof TypeCategory];

export function buildDefaultColumnMapping(sourceColumns: string[], targetColumns: string[]): ReplaceColumnMapping {
  const sourceSet = new Set(sourceColumns);
  const sourceByTarget: Record<string, string | null> = {};
  targetColumns.forEach((targetColumn) => {
    sourceByTarget[targetColumn] = sourceSet.has(targetColumn) ? targetColumn : null;
  });
  return { sourceByTarget, defaults: {} };
}

const hasFixedDefault = (fixedDefault?: InsertFieldDefault): fixedDefault is InsertFieldDefault =>
  Boolean(fixedDefault && fixedDefault.value.trim() !== "");

export function resolveInsertColumns(mapping: ReplaceColumnMapping, targetColumns: string[]): ReplaceInsertColumn[] {
  const insertColumns: ReplaceInsertColumn[] = [];
  targetColumns.forEach((targetColumn) => {
    const sourceColumn = mapping.sourceByTarget[targetColumn] ?? null;
    if (sourceColumn) {
      insertColumns.push({ targetColumn, sourceColumn, fixedDefault: null });
      return;
    }
    const fixedDefault = mapping.defaults[targetColumn];
    if (hasFixedDefault(fixedDefault)) {
      insertColumns.push({ targetColumn, sourceColumn: null, fixedDefault });
    }
  });
  return insertColumns;
}

export function getMappedSourceColumns(insertColumns: ReplaceInsertColumn[]): string[] {
  const mapped = insertColumns.flatMap((column) => (column.sourceColumn ? [column.sourceColumn] : []));
  return Array.from(new Set(mapped));
}

export function getIgnoredSourceColumns(insertColumns: ReplaceInsertColumn[], sourceColumns: string[]): string[] {
  const mapped = new Set(getMappedSourceColumns(insertColumns));
  return sourceColumns.filter((column) => !mapped.has(column));
}

export function findMissingRequiredColumns(
  insertColumns: ReplaceInsertColumn[],
  targetDetails: DbColumnMetadata[]
): string[] {
  const covered = new Set(insertColumns.map((column) => column.targetColumn));
  return targetDetails.flatMap((detail) =>
    !detail.is_nullable && detail.column_default == null && !covered.has(detail.column_name)
      ? [detail.column_name]
      : []
  );
}

function categorizeType(dataType?: string): TypeCategory {
  const lowerType = (dataType ?? "").toLowerCase();
  if (!lowerType) return TypeCategory.OTHER;
  if (lowerType.includes("geometry") || lowerType.includes("geography") || lowerType.includes("user-defined")) {
    return TypeCategory.GEOMETRY;
  }
  if (lowerType.includes("bool")) return TypeCategory.BOOLEAN;
  if (lowerType.includes("timestamp") || lowerType.includes("date") || lowerType.includes("time")) {
    return TypeCategory.TEMPORAL;
  }
  if (
    ["int", "numeric", "decimal", "float", "double", "real", "serial", "money"].some((token) =>
      lowerType.includes(token)
    )
  ) {
    return TypeCategory.NUMERIC;
  }
  if (lowerType.includes("char") || lowerType.includes("text")) return TypeCategory.TEXT;
  return TypeCategory.OTHER;
}

export function isNonTextType(dataType?: string): boolean {
  const category = categorizeType(dataType);
  return (
    category === TypeCategory.NUMERIC ||
    category === TypeCategory.TEMPORAL ||
    category === TypeCategory.BOOLEAN ||
    category === TypeCategory.GEOMETRY
  );
}

export function hasTypeConflict(sourceType?: string, targetType?: string): boolean {
  const sourceCategory = categorizeType(sourceType);
  const targetCategory = categorizeType(targetType);
  if (sourceCategory === TypeCategory.OTHER || targetCategory === TypeCategory.OTHER) return false;
  if (targetCategory === TypeCategory.TEXT) return false;
  return sourceCategory !== targetCategory;
}
