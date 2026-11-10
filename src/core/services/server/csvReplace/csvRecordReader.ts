export interface CsvRecord {
  readonly line: number;
  readonly fields: string[];
}

const QUOTE = '"';
const LINE_FEED = "\n";
const CARRIAGE_RETURN = "\r";

const unclosedQuoteMessage = (line: number): string =>
  `La comilla abierta en la línea ${line} no se cierra antes del final del archivo.`;

class RecordAccumulator {
  private fields: string[] = [];
  private field = "";
  private wasQuoted = false;
  private startLine = 1;

  append(char: string): void {
    this.field += char;
  }

  markQuoted(): void {
    this.wasQuoted = true;
  }

  isFieldStart(): boolean {
    return this.field === "" && !this.wasQuoted;
  }

  endField(): void {
    this.fields.push(this.field);
    this.field = "";
    this.wasQuoted = false;
  }

  hasContent(): boolean {
    return this.fields.length > 0 || this.field !== "" || this.wasQuoted;
  }

  finish(nextLine: number): CsvRecord | null {
    const hadContent = this.hasContent();
    this.endField();
    const record = hadContent ? { line: this.startLine, fields: this.fields } : null;
    this.fields = [];
    this.startLine = nextLine;
    return record;
  }

  get openLine(): number {
    return this.startLine;
  }
}

export function* readCsvRecords(chunks: Iterable<string>, delimiter: string): Generator<CsvRecord, void, undefined> {
  const accumulator = new RecordAccumulator();
  let line = 1;
  let inQuotes = false;
  let quoteSeen = false;
  let skipLineFeed = false;

  for (const chunk of chunks) {
    for (const char of chunk) {
      if (skipLineFeed) {
        skipLineFeed = false;
        if (char === LINE_FEED) continue;
      }
      if (inQuotes) {
        if (quoteSeen) {
          quoteSeen = false;
          if (char === QUOTE) {
            accumulator.append(QUOTE);
            continue;
          }
          inQuotes = false;
        } else if (char === QUOTE) {
          quoteSeen = true;
          continue;
        } else {
          if (char === LINE_FEED) line += 1;
          accumulator.append(char);
          continue;
        }
      }
      if (char === delimiter) {
        accumulator.endField();
      } else if (char === LINE_FEED || char === CARRIAGE_RETURN) {
        skipLineFeed = char === CARRIAGE_RETURN;
        line += 1;
        const record = accumulator.finish(line);
        if (record) yield record;
      } else if (char === QUOTE && accumulator.isFieldStart()) {
        inQuotes = true;
        accumulator.markQuoted();
      } else {
        accumulator.append(char);
      }
    }
  }

  if (inQuotes && !quoteSeen) throw new Error(unclosedQuoteMessage(accumulator.openLine));
  const lastRecord = accumulator.finish(line);
  if (lastRecord) yield lastRecord;
}
