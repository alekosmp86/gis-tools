import { FILE_KINDS, type AvanceFileKind } from "../constants";
import { detectFileKind } from "./fileName";

export interface FileSlots {
  readonly slots: Readonly<Record<AvanceFileKind, ReadonlyArray<File>>>;
  /** Files whose name is neither of the two kinds. */
  readonly unrecognized: ReadonlyArray<File>;
}

/** Each uploaded file is recognised by its name; the server remains the judge of the full name rule. */
export function assignFileSlots(files: ReadonlyArray<File>): FileSlots {
  const slots = Object.fromEntries(
    FILE_KINDS.map((kind) => [kind, files.filter((file) => detectFileKind(file.name) === kind)])
  ) as Record<AvanceFileKind, File[]>;
  return { slots, unrecognized: files.filter((file) => detectFileKind(file.name) === null) };
}

/** One file of each kind and nothing else. */
export function isCompletePair(files: ReadonlyArray<File>): boolean {
  const { slots, unrecognized } = assignFileSlots(files);
  return unrecognized.length === 0 && FILE_KINDS.every((kind) => slots[kind].length === 1);
}
