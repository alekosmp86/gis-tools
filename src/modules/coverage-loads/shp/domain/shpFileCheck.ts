import { BYTES_PER_GIB } from "../constants";
import { UPLOAD_CAP_BYTES } from "../job/constants.ts";
import { parseShpFileName } from "../job/fileName.ts";
import type { JobTarget } from "../job/types.ts";

export type ShpFileCheck =
  | { readonly ok: true; readonly target: JobTarget }
  | { readonly ok: false; readonly message: string };

const EMPTY_FILE_MESSAGE = (fileName: string) => `El archivo "${fileName}" está vacío.`;
const TOO_LARGE_MESSAGE = `El archivo supera el tamaño máximo de ${UPLOAD_CAP_BYTES / BYTES_PER_GIB} GiB.`;

/** The same name rules the server applies before it reads a byte of the upload. */
export function checkShpFile(file: Pick<File, "name" | "size">): ShpFileCheck {
  const parsed = parseShpFileName(file.name);
  if (!parsed.ok) return { ok: false, message: parsed.message };
  if (file.size < 1) return { ok: false, message: EMPTY_FILE_MESSAGE(file.name) };
  if (file.size > UPLOAD_CAP_BYTES) return { ok: false, message: TOO_LARGE_MESSAGE };
  return { ok: true, target: { table: parsed.table, prefix: parsed.prefix, fechaact: parsed.fechaact } };
}
