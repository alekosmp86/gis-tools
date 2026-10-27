const DECIMAL_PLACES = 2;
const SECONDS_SUFFIX = "s";

export const NO_DATA_TEXT = "sin dato";

export const secondsText = (seconds: number): string => `${seconds.toFixed(DECIMAL_PLACES).replace(".", ",")} ${SECONDS_SUFFIX}`;

export const textOrNoData = (value: string | null): string => value ?? NO_DATA_TEXT;
