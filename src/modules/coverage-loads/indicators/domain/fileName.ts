import { FILE_NAME_FORMAT_HINT, FILE_NAME_PATTERN } from "../constants";

type FileNameResult =
  | { readonly ok: true; readonly fechaact: string }
  | { readonly ok: false; readonly message: string };

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

function invalidName(fileName: string): FileNameResult {
  return {
    ok: false,
    message: `El archivo "${fileName}" no tiene un nombre válido: debe ser ${FILE_NAME_FORMAT_HINT} con una fecha real.`,
  };
}

/**
 * Accepts only `IndicadoresLTE_aaaammdd.csv` whose digits form a real calendar date. Pure
 * arithmetic on the digits: no `Date`, so no timezone can move the day.
 */
export function parseIndicatorsFileName(fileName: string): FileNameResult {
  const match = FILE_NAME_PATTERN.exec(fileName);
  if (!match) return invalidName(fileName);

  const [, yearText, monthText, dayText] = match;
  if (!isCalendarDate(Number(yearText), Number(monthText), Number(dayText))) return invalidName(fileName);

  return { ok: true, fechaact: `${yearText}-${monthText}-${dayText}` };
}
