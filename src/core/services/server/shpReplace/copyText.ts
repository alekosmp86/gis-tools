const COPY_NULL_MARKER = "\\N";

const COPY_ESCAPES: Readonly<Record<string, string>> = {
  "\\": "\\\\",
  "\t": "\\t",
  "\n": "\\n",
  "\r": "\\r",
};

const COPY_SPECIAL_CHARACTERS = /[\\\t\n\r]/g;
const NUL_CHARACTERS = /\u0000/g;

const escapeCopyCell = (cell: string): string =>
  cell
    .replace(NUL_CHARACTERS, "")
    .replace(COPY_SPECIAL_CHARACTERS, (character) => COPY_ESCAPES[character]);

const encodeCopyCell = (cell: string | null): string =>
  cell === null ? COPY_NULL_MARKER : escapeCopyCell(cell);

export const encodeCopyRow = (cells: ReadonlyArray<string | null>): string =>
  `${cells.map(encodeCopyCell).join("\t")}\n`;
