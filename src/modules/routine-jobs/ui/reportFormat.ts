const DECIMAL_PLACES = 2;
const SECONDS_SUFFIX = "s";
const MEGABYTE_DECIMAL_PLACES = 1;
const BYTES_PER_MEGABYTE = 1024 * 1024;
const MEGABYTE_SUFFIX = "MB";

import { NO_DATA_TEXT } from "../jobs/shared/text";

export { NO_DATA_TEXT };

export const decimalOrNoData = (value: number | null, digits: number): string =>
  value === null ? NO_DATA_TEXT : value.toFixed(digits);

export const secondsText = (seconds: number): string => `${seconds.toFixed(DECIMAL_PLACES).replace(".", ",")} ${SECONDS_SUFFIX}`;

export const megabytesText = (bytes: number): string =>
  `${(bytes / BYTES_PER_MEGABYTE).toFixed(MEGABYTE_DECIMAL_PLACES).replace(".", ",")} ${MEGABYTE_SUFFIX}`;

export const textOrNoData = (value: string | null): string => value ?? NO_DATA_TEXT;
