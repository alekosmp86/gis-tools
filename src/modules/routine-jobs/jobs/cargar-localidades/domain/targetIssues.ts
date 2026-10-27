import type { DbColumnMetadata } from "@/core/types/db";
import { GENERIC_GEOMETRY_TYPE, RELATION_FACT_KIND, RELATION_KIND, type RelationFactKind } from "../../actualizar-padron/constants";
import type { GeometryTyping } from "../../actualizar-padron/domain/geometryType";
import { GENERIC_SRID } from "../../actualizar-padron/constants";
import { TARGET_GEOMETRY_TYPE } from "../constants";

interface TargetRelationFact {
  kind: RelationFactKind;
  name: string;
}

export interface SpatialRefFacts {
  srtext: string | null;
  proj4text: string | null;
}

export interface TargetStructureFacts {
  label: string;
  relkind: string | undefined;
  hasChildren: boolean;
  isChild: boolean;
  facts: readonly TargetRelationFact[];
}

const RELATION_KIND_TEXT: ReadonlyMap<string, string> = new Map([
  ["v", "una vista"],
  ["m", "una vista materializada"],
  ["f", "una tabla foránea"],
]);
const NON_TABLE_KIND_TEXT = "un objeto que no es una tabla";
const WRITABLE_KINDS: readonly string[] = [RELATION_KIND.TABLE, RELATION_KIND.PARTITIONED];
const FACT_TEXT: Record<RelationFactKind, string> = {
  [RELATION_FACT_KIND.TRIGGER]: "triggers",
  [RELATION_FACT_KIND.RULE]: "reglas de reescritura",
};
const METRE_PROJ4_PATTERN = /\+units=m(\s|$)/;
const METRE_WKT_PATTERN = /UNIT\["(metre|meter)"/i;
const ACCEPTED_GEOMETRY_TYPES: readonly string[] = [GENERIC_GEOMETRY_TYPE, TARGET_GEOMETRY_TYPE];

export function relationKindIssues(label: string, relkind: string | undefined): string[] {
  if (relkind === undefined || WRITABLE_KINDS.includes(relkind)) return [];
  const kindText = RELATION_KIND_TEXT.get(relkind) ?? NON_TABLE_KIND_TEXT;
  return [`La tabla de localidades ${label} es ${kindText}: debe ser una tabla regular o particionada.`];
}

export function inheritanceIssues({ label, relkind, hasChildren, isChild }: TargetStructureFacts): string[] {
  const hasUnsafeChildren = hasChildren && relkind !== RELATION_KIND.PARTITIONED;
  if (!isChild && !hasUnsafeChildren) return [];
  return [`La tabla de localidades ${label} tiene herencia (tablas hijas o tabla padre): el proceso no puede escribir en ella con seguridad.`];
}

export function relationFactIssues({ label, facts }: TargetStructureFacts): string[] {
  return ([RELATION_FACT_KIND.TRIGGER, RELATION_FACT_KIND.RULE] as const).flatMap((kind) => {
    const names = facts.filter((fact) => fact.kind === kind).map((fact) => fact.name);
    if (names.length === 0) return [];
    return [`La tabla de localidades ${label} tiene ${FACT_TEXT[kind]} (${names.join(", ")}): quítelos, el proceso no escribe en tablas con ellos.`];
  });
}

function isMetreBased(spatialRef: SpatialRefFacts): boolean {
  return METRE_PROJ4_PATTERN.test(spatialRef.proj4text ?? "") || METRE_WKT_PATTERN.test(spatialRef.srtext ?? "");
}

export function geometryColumnIssues(
  label: string,
  column: string,
  typing: GeometryTyping | undefined,
  spatialRef: SpatialRefFacts | undefined
): string[] {
  if (typing === undefined) return [`La columna "${column}" de la tabla ${label} no es de tipo geometría.`];
  const typeName = typing.typeName?.toUpperCase() ?? GENERIC_GEOMETRY_TYPE;
  if (!ACCEPTED_GEOMETRY_TYPES.includes(typeName)) {
    return [`La columna geométrica "${column}" de la tabla ${label} es ${typing.typeName}; debe ser MultiPolygon.`];
  }
  if (typing.srid === GENERIC_SRID) {
    return [`La columna geométrica "${column}" de la tabla ${label} no tiene SRID: no se puede determinar el SRID de destino.`];
  }
  if (spatialRef === undefined) {
    return [`El SRID ${typing.srid} de la columna "${column}" de ${label} no existe en spatial_ref_sys.`];
  }
  if (!isMetreBased(spatialRef)) {
    return [`El SRID ${typing.srid} de la columna "${column}" de ${label} no es métrico: la tolerancia y la distancia de Hausdorff se miden en metros.`];
  }
  return [];
}

export function notNullIssues(
  label: string,
  catalog: readonly DbColumnMetadata[],
  identityColumns: readonly string[],
  writtenColumns: readonly string[]
): string[] {
  const identity = new Set(identityColumns);
  const written = new Set(writtenColumns);
  return catalog
    .filter(
      (entry) =>
        !entry.is_nullable && !entry.column_default && !identity.has(entry.column_name) && !written.has(entry.column_name)
    )
    .map(
      (entry) =>
        `La columna "${entry.column_name}" de ${label} es NOT NULL sin valor por defecto y el proceso no la escribe.`
    );
}

export function idSequenceIssues(label: string, idColumn: string, sequence: string | null): string[] {
  if (sequence !== null) return [];
  return [`La columna "${idColumn}" de ${label} no tiene secuencia: el proceso no puede asignar ids.`];
}
