import type { AnalysisRow, RepositoryRequest } from "../types";

/** Read-only access to the address data. The only implementation that touches a database is `PgAddressRepository`. */
export interface AddressRepository {
  runDuplicateAnalysis(request: RepositoryRequest): Promise<AnalysisRow[]>;
}
