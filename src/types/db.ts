export interface DbConfig {
  host: string;
  port: string;
  db_name: string;
  user: string;
  password?: string;
  schema_name: string;
  table_name: string;
}

export type SafeDbConfig = Omit<DbConfig, "password">;

export interface SavedDbProfile {
  id: string;
  name: string;
  config: SafeDbConfig;
  updatedAt: number;
}

export interface DbColumnMetadata {
  column_name: string;
  data_type: string;
  is_nullable: boolean;
  column_default: string | null;
  is_primary_key?: boolean;
}

export interface ColumnsResponse {
  success: boolean;
  schema: string;
  tableName: string;
  columns: string[];
  columnDetails?: DbColumnMetadata[];
  primaryKeyColumn?: string | null;
  totalRows: number;
  error?: string;
}

export interface DbConnectionFormRef {
  proceed: () => void;
}

export interface DbConnectionStatusPayload {
  isConnected: boolean;
  columns: string[];
  totalRows: number;
  columnDetails?: DbColumnMetadata[];
  primaryKeyColumn?: string | null;
  config: DbConfig;
}

export interface TestConnectionResponse {
  success: boolean;
  message?: string;
  error?: string;
}

export interface ExecuteSqlResponse {
  success: boolean;
  affectedRows?: number;
  message?: string;
  error?: string;
}

export interface ExecuteChunkProgress {
  currentBatch: number;
  totalBatches: number;
  processedStatements: number;
  totalStatements: number;
  successCount: number;
  errorCount: number;
  pct: number;
  phase?: string;
}

export interface ExecuteBatchResult {
  success: boolean;
  totalProcessed: number;
  affectedRows: number;
  errorCount: number;
  errors: string[];
  message: string;
}
export interface DatabaseFetchResult {
  records: Array<Record<string, unknown>>;
  columnTypes: Record<string, string>;
  detectedSrid: number;
  totalCount: number;
}

export interface DbStreamRecordsParams {
  config: DbConfig;
  totalRows?: number;
  onProgress?: (phase: string, current?: number, total?: number) => void;
}
