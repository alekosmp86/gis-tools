const DATASET_EXTENSIONS: ReadonlyArray<string> = [".shp", ".dbf"];
const DATE_TYPE = "date";
const TIMESTAMP_TYPE_PREFIX = "timestamp";
const DATE_SEPARATOR = "-";
const TIME_SEPARATOR = ":";
const DATE_TIME_SEPARATOR = " ";
const YEAR_DIGITS = 4;
const TWO_DIGITS = 2;

const normalizeDataType = (dataType: string | null | undefined): string =>
  (dataType ?? "").trim().toLowerCase();

const isTimestampType = (normalizedType: string): boolean =>
  normalizedType.startsWith(TIMESTAMP_TYPE_PREFIX);

const isDatasetEntry = (entryName: string): boolean => {
  const lowerName = entryName.toLowerCase();
  return DATASET_EXTENSIONS.some((extension) => lowerName.endsWith(extension));
};

const isNewer = (candidate: Date, latest: Date | null): boolean =>
  latest === null || candidate.getTime() > latest.getTime();

const newestDate = (dates: ReadonlyArray<Date>): Date | null =>
  dates.reduce<Date | null>((latest, candidate) => (isNewer(candidate, latest) ? candidate : latest), null);

const padNumber = (value: number, width: number = TWO_DIGITS): string => String(value).padStart(width, "0");

const formatDatePart = (date: Date): string =>
  [
    padNumber(date.getFullYear(), YEAR_DIGITS),
    padNumber(date.getMonth() + 1),
    padNumber(date.getDate()),
  ].join(DATE_SEPARATOR);

const formatTimePart = (date: Date): string =>
  [padNumber(date.getHours()), padNumber(date.getMinutes()), padNumber(date.getSeconds())].join(TIME_SEPARATOR);

export function pickDatasetModifiedAt(
  entryDates: ReadonlyMap<string, Date>,
  fallback: Date | null
): Date | null {
  const datasetDates = [...entryDates]
    .filter(([entryName]) => isDatasetEntry(entryName))
    .map(([, modified]) => modified);
  return newestDate(datasetDates) ?? fallback;
}

export function formatDateSuggestion(date: Date, dataType: string): string {
  const datePart = formatDatePart(date);
  return isTimestampType(normalizeDataType(dataType))
    ? `${datePart}${DATE_TIME_SEPARATOR}${formatTimePart(date)}`
    : datePart;
}

export function isDateLikeType(dataType: string | null | undefined): boolean {
  const normalizedType = normalizeDataType(dataType);
  return normalizedType === DATE_TYPE || isTimestampType(normalizedType);
}
