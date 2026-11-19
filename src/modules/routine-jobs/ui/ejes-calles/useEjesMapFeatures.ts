import { useCallback } from "react";
import type { EjesMapItem } from "../../jobs/ejes-calles/types";
import type { EjesGeometryMapBase } from "../shared/clientTypes";
import { useOutlineMapFeatures, type OutlineMapFeatures } from "../shared/map/useOutlineMapFeatures";
import type { EjesMapSubject } from "./ejesMapSubject";
import { createRoutineJobsClient } from "../shared/routineJobsClient";

const client = createRoutineJobsClient();

/** The connection and tables name what the cache holds: another database or table never reuses an outline. */
const scopeOf = (base: EjesGeometryMapBase): string =>
  [
    base.connection.host,
    base.connection.port,
    base.connection.db_name,
    base.connection.user,
    base.tables["ejes-origen"].schema,
    base.tables["ejes-origen"].table,
    base.tables["ejes-tramos"].schema,
    base.tables["ejes-tramos"].table,
    base.tables["ejes-padrones"].schema,
    base.tables["ejes-padrones"].table,
    base.tables["ejes-localidades"].schema,
    base.tables["ejes-localidades"].table,
    base.tables["ejes-departamentos"].schema,
    base.tables["ejes-departamentos"].table,
  ].join("|");

/** The outlines of one split or merge: the shared hook with the ejes geometry map request. */
export function useEjesMapFeatures(subject: EjesMapSubject, base: EjesGeometryMapBase): OutlineMapFeatures {
  const fetchOutlines = useCallback((items: EjesMapItem[]) => client.fetchEjesGeometryMap({ ...base, items }), [base]);
  return useOutlineMapFeatures(subject.items, scopeOf(base), fetchOutlines);
}
