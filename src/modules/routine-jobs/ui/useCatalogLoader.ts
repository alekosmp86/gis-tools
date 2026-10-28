import { useMemo, useState } from "react";
import { isConnectionFailure } from "@/ui-kit/components/tableSelectorLogic";
import type { TableListing } from "@/core/types/tableCatalog";
import {
  clearCatalogFailure,
  currentCatalogError,
  emptyCatalogFailures,
  recordCatalogFailure,
  type CatalogFailures,
} from "./catalogErrors";
import type { ClientConnection } from "./clientTypes";
import { trimConnection } from "./connectionProfiles";
import { RoutineJobsApiError, type RoutineJobsClient } from "./routineJobsClient";
import { catalogKey } from "./schemaDraft";
import { buildSharedLoadTables, firstCatalogError } from "./sharedCatalog";

const catalogKeyOf = (connection: ClientConnection, schema: string): string =>
  catalogKey(trimConnection(connection), schema.trim());

const connectionFailureOf = (error: unknown): string | null =>
  error instanceof RoutineJobsApiError && isConnectionFailure(error.status) ? error.message : null;

export interface CatalogLoader {
  loadTables: (schema: string) => Promise<TableListing>;
  reset: () => void;
  catalogErrorFor: (schemas: readonly string[]) => string | null;
}

/** Table listing shared by the selectors of one connection, remembering which schemas failed to connect. */
export function useCatalogLoader(client: Pick<RoutineJobsClient, "listTables">, connection: ClientConnection): CatalogLoader {
  const [catalogFailures, setCatalogFailures] = useState<CatalogFailures>(emptyCatalogFailures);

  const loadTables = useMemo(() => {
    const shared = buildSharedLoadTables(client, trimConnection(connection));
    return (schema: string) => {
      const key = catalogKeyOf(connection, schema);
      return shared(schema.trim()).then(
        (listing) => {
          setCatalogFailures(clearCatalogFailure(catalogFailures, key));
          return listing;
        },
        (error: unknown) => {
          const message = connectionFailureOf(error);
          if (message !== null) setCatalogFailures(recordCatalogFailure(catalogFailures, key, message));
          throw error;
        }
      );
    };
  }, [client, connection, catalogFailures]);

  const catalogErrorFor = (schemas: readonly string[]): string | null =>
    firstCatalogError(schemas.map((schema) => currentCatalogError(catalogFailures, catalogKeyOf(connection, schema))));

  return { loadTables, reset: () => setCatalogFailures(emptyCatalogFailures()), catalogErrorFor };
}
