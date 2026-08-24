export interface DbConfig {
  host: string;
  port: string;
  db_name: string;
  user: string;
  password?: string;
  schema_name: string;
  table_name: string;
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

export interface DbConnectionFormProps {
  onSuccess: (
    config: DbConfig,
    columns: string[],
    totalRows: number,
    columnDetails?: DbColumnMetadata[]
  ) => void;
}

export interface TestConnectionResponse {
  success: boolean;
  message?: string;
  error?: string;
}

export interface ColumnsPreviewProps {
  columns: string[];
  totalRows: number | null;
  onProceed: () => void;
}
