import type { SigraLayerId } from "../constants";
import { getSigraLayer } from "./layerRegistry";

const SINGLE_TABLE = "tabla";
const SEVERAL_TABLES = "tablas";

/** What a real load is about to do, said before it happens: which tables are replaced and that it cannot be undone. */
export function describeReplaceWarning(selectedLayerIds: ReadonlyArray<SigraLayerId>): string {
  const count = selectedLayerIds.length;
  const noun = count === 1 ? SINGLE_TABLE : SEVERAL_TABLES;
  const hasOptional = selectedLayerIds.some((layerId) => !getSigraLayer(layerId).required);
  const optionalPart = hasOptional ? " Incluye capas opcionales, que también se reemplazan." : "";
  return `Se reemplazará el contenido de ${count} ${noun} con lo que hoy publica SIGRA.${optionalPart} Esta acción no se puede deshacer.`;
}
