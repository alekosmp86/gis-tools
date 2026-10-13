import { GATE_AREA_RELATIVE_TOLERANCE, GATE_MAX_PIECE_VERTICES } from "../constants.ts";
import type { JobGates, TableMetrics, TestReport } from "../types.ts";

export interface StageMetrics {
  readonly rows: number;
  readonly area: number;
}

export interface WorkMetrics {
  readonly pieces: number;
  readonly maxVertices: number;
  readonly invalidPieces: number;
  readonly vertices: number;
  readonly area: number;
}

export interface GateInput {
  /** Records the file reader handed to COPY. */
  readonly recordsRead: number;
  readonly stage: StageMetrics;
  readonly work: WorkMetrics;
  /** Net area (shells minus holes) summed from the file itself. */
  readonly fileArea: number;
}

export interface GateVerdict {
  readonly gates: JobGates;
  readonly reasons: readonly string[];
}

export function relativeDifference(value: number, reference: number): number {
  if (reference === 0) return value === 0 ? 0 : Number.POSITIVE_INFINITY;
  return Math.abs(value - reference) / Math.abs(reference);
}

function collectReasons(input: GateInput, areaDiff: number, fileAreaDiff: number): string[] {
  const { stage, work } = input;
  const reasons: string[] = [];
  if (stage.rows === 0) reasons.push("la tabla de trabajo está vacía");
  if (stage.rows !== input.recordsRead) reasons.push(`se leyeron ${input.recordsRead} registros pero se cargaron ${stage.rows}`);
  if (work.pieces === 0) reasons.push("no se generaron piezas");
  if (work.maxVertices > GATE_MAX_PIECE_VERTICES) reasons.push(`una pieza tiene ${work.maxVertices} vértices (máximo ${GATE_MAX_PIECE_VERTICES})`);
  if (work.invalidPieces > 0) reasons.push(`${work.invalidPieces} piezas inválidas`);
  if (!(areaDiff <= GATE_AREA_RELATIVE_TOLERANCE)) reasons.push(`el área de las piezas difiere del área cruda en ${areaDiff}`);
  if (!(fileAreaDiff <= GATE_AREA_RELATIVE_TOLERANCE)) reasons.push(`el área cargada difiere del área del archivo en ${fileAreaDiff}`);
  return reasons;
}

/** Pure: the loaded rows and areas against the file, the pieces against the raw geometry. */
export function evaluateGates(input: GateInput): GateVerdict {
  const areaDiff = relativeDifference(input.work.area, input.stage.area);
  const fileAreaDiff = relativeDifference(input.stage.area, input.fileArea);
  const reasons = collectReasons(input, areaDiff, fileAreaDiff);
  const gates: JobGates = {
    stagingRows: input.stage.rows,
    maxVertices: input.work.maxVertices,
    invalidPieces: input.work.invalidPieces,
    areaRelativeDiff: Number.isFinite(areaDiff) ? areaDiff : 1,
    passed: reasons.length === 0,
  };
  return { gates, reasons };
}

function subtract(left: TableMetrics, right: TableMetrics): TableMetrics {
  return { rows: left.rows - right.rows, vertices: left.vertices - right.vertices, area: left.area - right.area };
}

/** `current` = what the target holds today, `new` = what the file would leave in it. */
export function buildTestReport(current: TableMetrics, incoming: TableMetrics): TestReport {
  return { current, new: incoming, diff: subtract(incoming, current) };
}
