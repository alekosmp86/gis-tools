import { useEffect, useRef, useState } from "react";
import { useStreamDbRecords } from "@/ui-kit/hooks/useDbQueries";
import { parseRecordsToGeoJson } from "@/core/spatial/GeoJsonDatasetBuilder";
import type { DbConfig, DbTableViewerState } from "@/core/types/db";

const INITIAL_PROGRESS_TEXT = "Conectando a base de datos PostgreSQL...";

/**
 * Streams the records of a PostgreSQL/PostGIS table and derives its spatial preview.
 *
 * The streaming effect depends only on the actual query inputs and on the referentially stable
 * `mutate` callback: the object returned by `useMutation` is recreated on every render and would
 * restart the stream indefinitely if used as a dependency.
 */
export function useDbTableViewerState(
  config: DbConfig,
  columns: string[],
  totalRows: number
): DbTableViewerState {
  const [records, setRecords] = useState<Array<Record<string, unknown>>>([]);
  const [detectedSrid, setDetectedSrid] = useState<number | null>(null);
  const [progressText, setProgressText] = useState<string>(INITIAL_PROGRESS_TEXT);

  const requestSequenceRef = useRef(0);
  const { mutate: streamDbRecords, isPending, isError, error } = useStreamDbRecords();

  useEffect(() => {
    const requestSequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = requestSequence;

    streamDbRecords(
      {
        config,
        totalRows,
        onProgress: setProgressText,
      },
      {
        onSuccess: (data) => {
          if (requestSequence !== requestSequenceRef.current) {
            return;
          }

          setRecords(data.records);
          setDetectedSrid(data.detectedSrid > 0 ? data.detectedSrid : null);
        },
        onError: () => {
          if (requestSequence !== requestSequenceRef.current) {
            return;
          }

          setRecords([]);
          setDetectedSrid(null);
        },
      }
    );
  }, [config, streamDbRecords, totalRows]);

  // Spatial preview is derived from the streamed records, never mirrored into state, so it can
  // never desync from the dataset or from a changed column list. React Compiler memoizes this
  // derivation, so it only re-runs when `records` or `columns` actually change.
  const { geojson, detectedGeometryType } = parseRecordsToGeoJson(records, columns);

  return {
    records,
    geojson,
    detectedGeometryType,
    detectedSrid,
    progressText,
    isPending,
    isError,
    error,
  };
}
