import type { AnalysisRow, DbConnection, ProvinceOption, RepositoryRequest } from "../types";

/** Read-only access to the address data. The only implementation that touches a database is `PgAddressRepository`. */
export interface AddressRepository {
  runDuplicateAnalysis(request: RepositoryRequest): Promise<AnalysisRow[]>;
  listProvinces(connection: DbConnection): Promise<ProvinceOption[]>;
}
