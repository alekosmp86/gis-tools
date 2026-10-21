import { FILE_KINDS, FILE_NAME_FORMAT_HINTS, FILE_NAME_PATTERNS, FILE_PREFIX, type AvanceFileKind } from "../constants";

type FileNameResult =
  | { readonly ok: true; readonly kind: AvanceFileKind; readonly fechaact: string }
  | { readonly ok: false; readonly message: string };

const MONTHS_PER_YEAR = 12;
const FEBRUARY = 2;
const LEAP_FEBRUARY_DAYS = 29;
const DAYS_BY_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;
const GREGORIAN_CYCLE = 400;
const CENTURY = 100;
const LEAP_CYCLE = 4;
const MIN_YEAR = 1;
const DAY_DIGITS = 2;
const MONTH_END = 4;

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

function invalidName(fileName: string): FileNameResult {
  const hints = FILE_KINDS.map((kind) => FILE_NAME_FORMAT_HINTS[kind]).join(" o ");
  return {
    ok: false,
    message: `El archivo "${fileName}" no tiene un nombre válido: debe ser ${hints} con una fecha real.`,
  };
}

function matchKind(fileName: string): { kind: AvanceFileKind; digits: string } | null {
  for (const kind of FILE_KINDS) {
    const match = FILE_NAME_PATTERNS[kind].exec(fileName);
    if (match) return { kind, digits: match[1] };
  }
  return null;
}

/** Which of the two files a name designates, from its prefix alone (no date check); `null` when it is neither. */
export function detectFileKind(fileName: string): AvanceFileKind | null {
  return FILE_KINDS.find((kind) => fileName.startsWith(FILE_PREFIX[kind])) ?? null;
}

/**
 * Accepts only `SituacionFTTH_INT_ddMMyyyy.csv` or `SituacionFTTH_UDPEM_ddMMyyyy.csv` whose digits
 * form a real calendar date. Pure arithmetic on the digits: no `Date`, so no timezone moves the day.
 */
export function parseAvanceFileName(fileName: string): FileNameResult {
  const matched = matchKind(fileName);
  if (!matched) return invalidName(fileName);

  const { kind, digits } = matched;
  const day = Number(digits.slice(0, DAY_DIGITS));
  const month = Number(digits.slice(DAY_DIGITS, MONTH_END));
  const year = Number(digits.slice(MONTH_END));
  if (!isCalendarDate(year, month, day)) return invalidName(fileName);

  return { ok: true, kind, fechaact: digits };
}
