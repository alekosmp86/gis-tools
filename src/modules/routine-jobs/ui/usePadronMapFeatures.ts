import { useCallback } from "react";
import type { GeometryMapItem } from "../jobs/actualizar-padron/types";
import type { GeometryMapBase } from "./clientTypes";
import { useOutlineMapFeatures, type OutlineMapFeatures } from "./map/useOutlineMapFeatures";
import type { PadronMapSubject } from "./padronMapSubject";
import { createRoutineJobsClient } from "./routineJobsClient";

export { MapLoadStatus } from "./map/useOutlineMapFeatures";
export type PadronMapFeatures = OutlineMapFeatures;

const client = createRoutineJobsClient();

/** The connection and tables name what the cache holds: another database or table never reuses an outline. */
const scopeOf = (base: GeometryMapBase): string =>
  [
    base.connection.host,
    base.connection.port,
    base.connection.db_name,
    base.connection.user,
    base.stagingSchema,
    base.stagingTable,
    base.cartoSchema,
    base.targetTable,
  ].join("|");

/** The outlines of one padrón subject: the shared hook with the padrones geometry map request. */
export function usePadronMapFeatures(subject: PadronMapSubject, base: GeometryMapBase): PadronMapFeatures {
  const fetchOutlines = useCallback(
    (items: GeometryMapItem[]) => client.fetchGeometryMap({ ...base, items }),
    [base]
  );
  return useOutlineMapFeatures(subject.items, scopeOf(base), fetchOutlines);
}
