import { ShapefileReaderError } from "../reader/errors.ts";
import { errorText } from "../scrub.ts";
import type { PipelineOutcome } from "../pipeline.ts";
import type { JobGates } from "../types.ts";

export const FAILURE_CODE = {
  DB_CONNECT: "DB_CONNECT_FAILED",
  DB_CONNECTION_LOST: "DB_CONNECTION_LOST",
  TABLE_LOCKED: "TABLE_LOCKED",
  SHP_EMPTY: "SHP_EMPTY",
  SHP_INVALID: "SHP_INVALID",
  STAGE_MISMATCH: "STAGE_MISMATCH",
  GATE_FAILED: "GATE_FAILED",
  SWAP_MISMATCH: "SWAP_MISMATCH",
  STATEMENT_TIMEOUT: "STATEMENT_TIMEOUT",
  LOCK_TIMEOUT: "LOCK_TIMEOUT",
  PRIVILEGE_DENIED: "PRIVILEGE_DENIED",
  SERVER_RESOURCES: "SERVER_RESOURCES",
  LOAD_ERROR: "LOAD_ERROR",
} as const;

const PG_QUERY_CANCELED = "57014";
const PG_INSUFFICIENT_PRIVILEGE = "42501";
const PG_LOCK_NOT_AVAILABLE = "55P03";
const PG_RESOURCE_CLASS = "53";
const CONNECTION_ERROR_CODES: readonly string[] = ["ECONNRESET", "EPIPE", "ETIMEDOUT", "ECONNREFUSED", "ENOTFOUND"];

/** A failure whose code and Spanish message are decided where it is raised. */
export class JobStepError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

export class GateFailedError extends JobStepError {
  readonly gates: JobGates;

  constructor(gates: JobGates, reasons: readonly string[]) {
    super(FAILURE_CODE.GATE_FAILED, `La carga no pasó las verificaciones: ${reasons.join("; ")}.`);
    this.gates = gates;
  }
}

export class CancelledError extends Error {
  constructor() {
    super("Carga cancelada.");
    this.name = new.target.name;
  }
}

export function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new CancelledError();
}

function codeOf(error: unknown): string | null {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : null;
}

function failed(code: string, message: string): PipelineOutcome {
  return { kind: "FAILED", error: { code, message } };
}

function fromDatabaseCode(code: string, fallbackMessage: string): PipelineOutcome | null {
  if (code === PG_QUERY_CANCELED) return failed(FAILURE_CODE.STATEMENT_TIMEOUT, "Una sentencia superó el tiempo máximo permitido o fue cancelada por el servidor.");
  if (code === PG_INSUFFICIENT_PRIVILEGE) return failed(FAILURE_CODE.PRIVILEGE_DENIED, `Privilegios insuficientes: ${fallbackMessage}`);
  if (code === PG_LOCK_NOT_AVAILABLE) return failed(FAILURE_CODE.LOCK_TIMEOUT, "No se pudo bloquear la tabla destino a tiempo: otra sesión la está usando.");
  if (code.startsWith(PG_RESOURCE_CLASS)) return failed(FAILURE_CODE.SERVER_RESOURCES, `El servidor se quedó sin recursos: ${fallbackMessage}`);
  if (CONNECTION_ERROR_CODES.includes(code)) return failed(FAILURE_CODE.DB_CONNECTION_LOST, "Se perdió la conexión con la base de datos.");
  return null;
}

/** Maps anything thrown inside the pipeline to its outcome. A cancel request always wins. */
export function outcomeFromError(error: unknown, signal: AbortSignal): PipelineOutcome {
  if (error instanceof CancelledError || signal.aborted) return { kind: "CANCELLED" };
  if (error instanceof JobStepError) return failed(error.code, error.message);
  if (error instanceof ShapefileReaderError) return failed(FAILURE_CODE.SHP_INVALID, error.message);
  const message = errorText(error, "La carga falló por un error desconocido.");
  const code = codeOf(error);
  return (code === null ? null : fromDatabaseCode(code, message)) ?? failed(FAILURE_CODE.LOAD_ERROR, message);
}
