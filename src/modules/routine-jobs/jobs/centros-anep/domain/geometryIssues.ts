import { GENERIC_SRID } from "../../actualizar-padron/constants";
import type { GeometryTyping } from "../../actualizar-padron/domain/geometryType";

export function geometrySridIssues(label: string, column: string, typing: GeometryTyping | undefined): string[] {
  if (typing === undefined) return [`La columna "${column}" de la tabla ${label} no es de tipo geometría.`];
  if (typing.srid === GENERIC_SRID) {
    return [`La columna geométrica "${column}" de la tabla ${label} no tiene SRID: no se puede determinar el SRID de destino.`];
  }
  return [];
}
