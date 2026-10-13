import { readFileSync } from "node:fs";
import type { ParsedCut, RejectedRow } from "@/modules/coverage-loads/indicators/types";

export const HEADER_LINE = "Departamento;Localidad;%;Cobertura";

export const CRLF = "\r\n";
export const LF = "\n";

/** Independent oracle for the production encoder: Node's own latin1. */
export function latin1Bytes(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text, "latin1"));
}

export function fixtureBytes(name: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
}

export interface CsvOptions {
  readonly eol?: string;
  readonly header?: string;
  readonly trailingEol?: boolean;
}

/** A latin1 `IndicadoresLTE` file: header line plus the given data lines. */
export function csvBytes(dataLines: ReadonlyArray<string>, options: CsvOptions = {}): Uint8Array {
  const eol = options.eol ?? LF;
  const header = options.header ?? HEADER_LINE;
  const text = [header, ...dataLines].join(eol) + (options.trailingEol === false ? "" : eol);
  return latin1Bytes(text);
}

export function dataLine(departamento: string, localidad: string, porcentaje: string, cobertura: string): string {
  return [departamento, localidad, porcentaje, cobertura].join(";");
}

/** `count` valid, distinct data lines. */
export function validDataLines(count: number): string[] {
  return Array.from({ length: count }, (_, index) =>
    dataLine(`DEPTO${index % 19}`, `LOCALIDAD ${index}`, String((index % 100) + 0.5), index % 2 === 0 ? "Si" : "No")
  );
}

export function makeCut(
  fechaact: string,
  rows: ReadonlyArray<{ departamento: string; localidad: string; porcentaje: string; cobertura: string }>,
  rejected: ReadonlyArray<RejectedRow> = [],
  fileName = `IndicadoresLTE_${fechaact.replace(/-/g, "")}.csv`
): ParsedCut {
  return { fileName, fechaact, rows, rejected };
}

export function makeRows(count: number, prefix = "LOC", porcentaje = "75.5", cobertura = "Si") {
  return Array.from({ length: count }, (_, index) => ({
    departamento: `DEP${index % 7}`,
    localidad: `${prefix} ${String(index).padStart(4, "0")}`,
    porcentaje,
    cobertura,
  }));
}

export function makeRejected(file: string, count: number): RejectedRow[] {
  return Array.from({ length: count }, (_, index) => ({
    file,
    line: index + 2,
    text: `bad row ${index}`,
    reason: "motivo",
  }));
}

/** `YYYY-MM-DD` of the day that is `offsetDays` from the real clock (UTC, like PGlite's now()). */
export function isoDateFromNow(offsetDays: number): string {
  const millisPerDay = 24 * 60 * 60 * 1000;
  return new Date(Date.now() + offsetDays * millisPerDay).toISOString().slice(0, 10);
}

/** `dd-MM-yyyy` for a `YYYY-MM-DD` text, without a Date. */
export function toDdMmYyyy(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${day}-${month}-${year}`;
}
