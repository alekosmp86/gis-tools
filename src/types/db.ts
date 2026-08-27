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
}

export interface ColumnsResponse {
  success: boolean;
  schema: string;
  tableName: string;
  columns: string[];
  columnDetails?: DbColumnMetadata[];
  totalRows: number;
  error?: string;
}

export interface DbConnectionFormRef {
  proceed: () => void;
}

export interface DbConnectionFormProps {
  onSuccess: (
    config: DbConfig,
    columns: string[],
    totalRows: number,
    columnDetails?: DbColumnMetadata[]
  ) => void;
  onStatusChange?: (status: {
    isConnected: boolean;
    columns: string[];
    totalRows: number;
    columnDetails?: DbColumnMetadata[];
    config: DbConfig;
  }) => void;
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

