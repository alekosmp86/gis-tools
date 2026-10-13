import { SHP_PREFIX_TABLE } from "./types.ts";
import type { ShpPrefix, ShpTable } from "./types.ts";

export type ShpFileNameResult =
  | { readonly ok: true; readonly prefix: ShpPrefix; readonly table: ShpTable; readonly fechaact: string }
  | { readonly ok: false; readonly message: string };

const FILE_NAME_PATTERN = /^(NRUruguay|WCDMAUruguay|NBIoTUruguay|LTEUruguay)_(\d{4})(\d{2})(\d{2})\.shp$/;
const FILE_NAME_FORMAT_HINT = "<Prefijo>_aaaammdd.shp (NRUruguay, WCDMAUruguay, NBIoTUruguay o LTEUruguay)";

const MONTHS_PER_YEAR = 12;
const FEBRUARY = 2;
const LEAP_FEBRUARY_DAYS = 29;
const DAYS_BY_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;
const GREGORIAN_CYCLE = 400;
const CENTURY = 100;
const LEAP_CYCLE = 4;
const MIN_YEAR = 1;

function isLeapYear(year: number): boolean {
  return (year % LEAP_CYCLE === 0 && year % CENTURY !== 0) || year % GREGORIAN_CYCLE === 0;
}

function daysInMonth(year: number, month: number): number {
  return month === FEBRUARY && isLeapYear(year) ? LEAP_FEBRUARY_DAYS : DAYS_BY_MONTH[month - 1];
}

function isCalendarDate(year: number, month: number, day: number): boolean {
  if (year < MIN_YEAR) return false;
  if (month < 1 || month > MONTHS_PER_YEAR) return false;
  return day >= 1 && day <= daysInMonth(year, month);
}

function invalidName(fileName: string): ShpFileNameResult {
  return {
    ok: false,
    message: `El archivo "${fileName}" no tiene un nombre válido: debe ser ${FILE_NAME_FORMAT_HINT} con una fecha real.`,
  };
}

/** Accepts only `<Prefix>_aaaammdd.shp` with a real calendar date. Pure digit arithmetic, no `Date`. */
export function parseShpFileName(fileName: string): ShpFileNameResult {
  const match = FILE_NAME_PATTERN.exec(fileName);
  if (!match) return invalidName(fileName);

  const [, prefixText, yearText, monthText, dayText] = match;
  if (!isCalendarDate(Number(yearText), Number(monthText), Number(dayText))) return invalidName(fileName);

  const prefix = prefixText as ShpPrefix;
  return { ok: true, prefix, table: SHP_PREFIX_TABLE[prefix], fechaact: `${yearText}-${monthText}-${dayText}` };
}
