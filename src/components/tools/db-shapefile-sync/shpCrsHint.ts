import { describeCrsFromPrj } from "@/core/services/shpSrid";

const NO_PRJ_HINT = "El archivo no incluye .prj: ingrese el SRID de origen.";
const UNRECOGNIZED_CRS_HINT = "CRS del archivo: no reconocido, ingrese el SRID de origen.";
const UNNAMED_CRS_LABEL = "sin nombre";

export function buildCrsHint(prjText: string | null | undefined): string {
  if (!prjText?.trim()) return NO_PRJ_HINT;
  const { name, srid } = describeCrsFromPrj(prjText);
  if (srid !== null) return `CRS del archivo: ${name ?? UNNAMED_CRS_LABEL} (EPSG:${srid})`;
  if (name !== null) {
    return `CRS del archivo: ${name} — no se pudo determinar el código EPSG, ingréselo manualmente.`;
  }
  return UNRECOGNIZED_CRS_HINT;
}
