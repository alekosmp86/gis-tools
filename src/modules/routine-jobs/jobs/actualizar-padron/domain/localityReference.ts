import { plural } from "../../shared/text";

export interface LocalityReferenceCount {
  total: number;
  unresolved: number;
}

export type LocalityReferenceVerdict =
  | { kind: "ok" }
  | { kind: "refuse"; message: string }
  | { kind: "warn"; warning: string };

const REFUSAL_SHARE_DIVISOR = 2;

const refusalOf = ({ total, unresolved }: LocalityReferenceCount, localityLabel: string): string =>
  `La tabla de localidades elegida (${localityLabel}) no contiene las localidades que usa la tabla de destino: ${unresolved} de ${total} padrones apuntan a un id que no existe en ella. Los padrones referencian unidades territoriales: elija territorial_unit.`;

const warningOf = (unresolved: number, targetLabel: string, localityLabel: string): string =>
  `${plural(unresolved, `padrón de ${targetLabel} apunta`, `padrones de ${targetLabel} apuntan`)} a una localidad que no existe en ${localityLabel}.`;

export function localityReferenceVerdict(
  count: LocalityReferenceCount,
  targetLabel: string,
  localityLabel: string
): LocalityReferenceVerdict {
  if (count.total === 0 || count.unresolved === 0) return { kind: "ok" };
  if (count.unresolved * REFUSAL_SHARE_DIVISOR >= count.total) {
    return { kind: "refuse", message: refusalOf(count, localityLabel) };
  }
  return { kind: "warn", warning: warningOf(count.unresolved, targetLabel, localityLabel) };
}
