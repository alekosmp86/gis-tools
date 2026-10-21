const DATE_PAD = 2;

function padDatePart(part: number): string {
  return String(part).padStart(DATE_PAD, "0");
}

/** `aaaammdd` from the given instant's local calendar parts (the server's run day, not a database date). */
export function formatCompactDate(day: Date): string {
  return `${day.getFullYear()}${padDatePart(day.getMonth() + 1)}${padDatePart(day.getDate())}`;
}
