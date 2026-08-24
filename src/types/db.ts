export interface DbConfig {
  host: string;
  port: string;
  db_name: string;
  user: string;
  password?: string;
  schema_name: string;
  table_name: string;
}

export interface DbConnectionFormProps {
  onSuccess: (config: DbConfig, columns: string[], totalRows: number) => void;
}

export interface ColumnsResponse {
  success: boolean;
  schema: string;
  tableName: string;
  columns: string[];
  totalRows: number;
  error?: string;
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
