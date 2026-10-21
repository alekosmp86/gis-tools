import { HTTP_STATUS } from "./httpResponses";
import type { ValidationResult } from "./requestReaders";

const CONTENT_LENGTH_HEADER = "content-length";
const TRUE_VALUE = "true";
const NOT_MULTIPART_MESSAGE = "La solicitud debe ser un formulario multipart válido.";
const LENGTH_REQUIRED_MESSAGE = "La solicitud debe declarar su tamaño (encabezado Content-Length).";

export interface BodyRefusal {
  readonly status: number;
  readonly message: string;
}

/**
 * Refuses an upload that declares no size (411) or a size over the cap (413) before the form is
 * read. A malformed header is left to the form reader; null means the request may proceed.
 */
export function checkDeclaredBodySize(request: Request, maxBodyBytes: number): BodyRefusal | null {
  const declared = request.headers.get(CONTENT_LENGTH_HEADER);
  if (declared === null) return { status: HTTP_STATUS.LENGTH_REQUIRED, message: LENGTH_REQUIRED_MESSAGE };
  if (!/^\d+$/.test(declared.trim())) return null;
  return Number(declared) > maxBodyBytes
    ? { status: HTTP_STATUS.PAYLOAD_TOO_LARGE, message: `La solicitud supera el tamaño máximo de ${maxBodyBytes} bytes.` }
    : null;
}

export async function readForm(request: Request): Promise<ValidationResult<FormData>> {
  try {
    return { ok: true, value: await request.formData() };
  } catch {
    return { ok: false, error: NOT_MULTIPART_MESSAGE };
  }
}

export function readFlag(form: FormData, fieldName: string): boolean {
  return form.get(fieldName) === TRUE_VALUE;
}
