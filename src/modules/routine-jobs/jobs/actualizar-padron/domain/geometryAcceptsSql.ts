import type { AcceptedGeometry } from "../types";
import { NEW_KEY_VALUE_COLUMNS } from "./pairChoicesSql";
import { typedValuesSql } from "./typedValuesSql";

/** The body of the geometry_accepts CTE: one typed key row per accepted geometry, or no rows of the same shape when there are none. */
export function geometryAcceptsValuesSql(accepts: readonly AcceptedGeometry[]): string {
  const rows = accepts.map((accept) => [accept.typePadron, accept.provinceId, accept.localityId, accept.number]);
  return typedValuesSql(NEW_KEY_VALUE_COLUMNS, rows, "accepts");
}
