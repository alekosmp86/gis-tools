import type { RunSession } from "../../cargar-padrones/types";
import { numberOf } from "../../shared/rowMapping";
import { WRITTEN_ALIAS } from "../domain/loadWriteSql";

export const ANALYSIS_CHANGED_MESSAGE = "Los ejes de origen o los tramos de destino cambiaron desde el análisis; vuelva a analizar.";
export const CHOICE_NOT_APPLICABLE_MESSAGE =
  "Se eligió un destino para un punto que no requiere revisión o para una división que no se puede aplicar. Vuelva a analizar.";

/** The abort message of invalid choices, naming up to `INVALID_CHOICE_REFS_LIMIT` old `reftramo`s so the user can find them. */
export const choiceNotApplicableOf = (oldRefs: readonly string[]): string =>
  oldRefs.length === 0 ? CHOICE_NOT_APPLICABLE_MESSAGE : `${CHOICE_NOT_APPLICABLE_MESSAGE} Tramos: ${oldRefs.join(", ")}.`;

export function assertWritten(label: string, written: number, expected: number): void {
  if (written !== expected) {
    throw new Error(`Las filas escritas en ${label} (${written}) no coinciden con las esperadas (${expected}).`);
  }
}

export async function writtenBy(session: RunSession, sql: string): Promise<number> {
  return numberOf((await session.query(sql)).rows[0]?.[WRITTEN_ALIAS]);
}

/** One pg client: each statement is built from the temp tables of the statements before it. */
export async function runInOrder(session: RunSession, statements: readonly string[]): Promise<void> {
  for (const statement of statements) {
    // react-doctor-disable-next-line react-doctor/async-await-in-loop
    await session.query(statement);
  }
}
