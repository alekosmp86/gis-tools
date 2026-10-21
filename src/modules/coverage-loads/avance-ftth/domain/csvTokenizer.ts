import { CSV_ENCLOSURE, CSV_SEPARATOR } from "../../constants";

const LINE_FEED = "\n";
const CARRIAGE_RETURN = "\r";

function isLineBreak(char: string): boolean {
  return char === LINE_FEED || char === CARRIAGE_RETURN;
}

/** Index of the quote that closes an enclosure opened just before `from` on the same physical line, or -1. */
function findClosingEnclosure(text: string, from: number): number {
  for (let position = from; position < text.length; position += 1) {
    const char = text[position];
    if (isLineBreak(char)) return -1;
    if (char !== CSV_ENCLOSURE) continue;
    if (text[position + 1] !== CSV_ENCLOSURE) return position;
    position += 1;
  }
  return -1;
}

export interface RawRecord {
  readonly line: number;
  readonly raw: string;
  readonly fields: ReadonlyArray<string>;
  readonly unterminatedQuote: boolean;
}

/**
 * Splits text into records: `;` separated, `"` enclosure (with `""` as an escaped quote; never
 * spanning lines), LF, CRLF or a lone CR ending a record. Each record keeps its raw source
 * text and the 1-based physical line it starts on. A quote that never closes confines the damage to
 * its own physical line: that record is flagged and parsing resumes on the next line.
 */
export function tokenizeRecords(text: string): RawRecord[] {
  const records: RawRecord[] = [];
  let fields: string[] = [];
  let current = "";
  let inEnclosure = false;
  let unclosable = false;
  let atFieldStart = true;
  let recordStart = 0;
  let recordLine = 1;
  let line = 1;

  const finishRecord = (endIndex: number) => {
    fields.push(current);
    records.push({
      line: recordLine,
      raw: text.slice(recordStart, endIndex),
      fields,
      unterminatedQuote: inEnclosure,
    });
    fields = [];
    current = "";
    atFieldStart = true;
    inEnclosure = false;
    unclosable = false;
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inEnclosure && !unclosable) {
      if (char === CSV_ENCLOSURE && text[index + 1] === CSV_ENCLOSURE) {
        current += CSV_ENCLOSURE;
        index += 1;
      } else if (char === CSV_ENCLOSURE) {
        inEnclosure = false;
      } else {
        current += char;
      }
    } else if (char === CSV_ENCLOSURE && atFieldStart) {
      inEnclosure = true;
      unclosable = findClosingEnclosure(text, index + 1) === -1;
      atFieldStart = false;
    } else if (char === CSV_SEPARATOR) {
      fields.push(current);
      current = "";
      atFieldStart = true;
    } else if (isLineBreak(char)) {
      finishRecord(index);
      if (char === CARRIAGE_RETURN && text[index + 1] === LINE_FEED) index += 1;
      line += 1;
      recordStart = index + 1;
      recordLine = line;
    } else {
      current += char;
      atFieldStart = false;
    }
  }
  if (recordStart < text.length) finishRecord(text.length);
  return records;
}
