import { VALIDATION_MIN_RATIO } from "../constants";
import type { LoadVerdict, LoadVerdictInput } from "../types";

function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

function acceptedMessage(input: LoadVerdictInput): string {
  return `Validación correcta: ${input.stagedCount} registros descargados frente a ${input.finalCount} en la tabla actual.`;
}

function rejectedMessage(input: LoadVerdictInput, ratio: number): string {
  return (
    `Carga rechazada: se descargaron ${input.stagedCount} registros y la tabla actual tiene ${input.finalCount} ` +
    `(${formatPercent(ratio)}, mínimo ${formatPercent(VALIDATION_MIN_RATIO)}). La tabla no se modificó.`
  );
}

export function evaluateLoad(input: LoadVerdictInput): LoadVerdict {
  if (input.finalCount === 0) {
    return { ok: true, ratio: null, message: acceptedMessage(input) };
  }
  const ratio = input.stagedCount / input.finalCount;
  if (ratio >= VALIDATION_MIN_RATIO) {
    return { ok: true, ratio, message: acceptedMessage(input) };
  }
  return { ok: false, ratio, message: rejectedMessage(input, ratio) };
}
