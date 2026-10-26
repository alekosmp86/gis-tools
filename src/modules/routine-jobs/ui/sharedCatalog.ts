import type { TableListing } from "@/core/types/tableCatalog";
import { catalogKey, createInFlightMemo } from "./schemaDraft";
import type { ClientConnection } from "./clientTypes";
import type { RoutineJobsClient } from "./routineJobsClient";

/**
 * Builds the table listing function shared by the three table selectors of one connection: a schema
 * is listed once while the request is pending, however many selectors ask for it at the same time.
 */
export function buildSharedLoadTables(
  client: Pick<RoutineJobsClient, "listTables">,
  connection: ClientConnection,
): (schema: string) => Promise<TableListing> {
  const memo = createInFlightMemo<string, TableListing>();
  return (schema) => memo(catalogKey(connection, schema), () => client.listTables(connection, schema));
}

/** The first error of the list, or null when none of the entries carries one. */
export function firstCatalogError(errors: ReadonlyArray<string | null>): string | null {
  for (const error of errors) {
    if (error !== null) return error;
  }
  return null;
}
