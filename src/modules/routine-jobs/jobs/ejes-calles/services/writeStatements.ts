import type { RunSession } from "../../cargar-padrones/types";
import { numberOf } from "../../shared/rowMapping";
import { WRITTEN_ALIAS } from "../domain/loadWriteSql";

export const ANALYSIS_CHANGED_MESSAGE = "Los ejes de origen o los tramos de destino cambiaron desde el análisis; vuelva a analizar.";
export const CHOICE_NOT_APPLICABLE_MESSAGE =
  "Se eligió un destino para un punto que no requiere revisión o para una división que no se puede aplicar. Vuelva a analizar.";

export const TWIN_PICK_NOT_APPLICABLE_MESSAGE =
  "Se eligió una copia para un tramo que no existe en el origen con esa localidad y departamento. Vuelva a analizar.";

export const MANUAL_SPLIT_NOT_APPLICABLE_MESSAGE =
  "Una división manual no se puede aplicar: su tramo anterior ya no falta en el origen o alguna pieza elegida ya no está disponible. Vuelva a analizar.";

export const MOVE_TARGET_MISSING_MESSAGE =
  "Los puntos de acceso se moverían a un reftramo que no existirá después de la carga. Vuelva a analizar.";

const withRefsNote = (message: string, refs: readonly string[]): string =>
  refs.length === 0 ? message : `${message} Tramos: ${refs.join(", ")}.`;

/** The abort message of invalid choices, naming up to `INVALID_CHOICE_REFS_LIMIT` old `reftramo`s so the user can find them. */
export const choiceNotApplicableOf = (oldRefs: readonly string[]): string => withRefsNote(CHOICE_NOT_APPLICABLE_MESSAGE, oldRefs);

/** The abort message of picks that name no copy of the staging, naming up to `INVALID_TWIN_PICK_REFS_LIMIT` `reftramo`s. */
export const twinPickNotApplicableOf = (refs: readonly string[]): string => withRefsNote(TWIN_PICK_NOT_APPLICABLE_MESSAGE, refs);

/** The abort message of manual splits the analysis ignores, naming up to `INVALID_MANUAL_SPLIT_REFS_LIMIT` old `reftramo`s. */
export const manualSplitNotApplicableOf = (refs: readonly string[]): string => withRefsNote(MANUAL_SPLIT_NOT_APPLICABLE_MESSAGE, refs);

/** The abort message of move targets no section will hold, naming up to `INVALID_CHOICE_REFS_LIMIT` as `destino (de origen)`. */
export const moveTargetMissingOf = (targets: readonly string[]): string =>
  `${MOVE_TARGET_MISSING_MESSAGE} Destinos: ${targets.join(", ")}.`;

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
