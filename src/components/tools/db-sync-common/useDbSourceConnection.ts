import { useRef, useState } from "react";
import type {
  DbColumnMetadata,
  DbConfig,
  DbConnectionFormRef,
  DbConnectionStatusPayload,
} from "@/core/types/db";

export function useDbSourceConnection(onConnected: () => void) {
  const [dbConfig, setDbConfig] = useState<DbConfig | null>(null);
  const [dbColumns, setDbColumns] = useState<string[]>([]);
  const [columnDetails, setColumnDetails] = useState<DbColumnMetadata[]>([]);
  const [isDbConnected, setIsDbConnected] = useState(false);

  const dbFormRef = useRef<DbConnectionFormRef | null>(null);

  const handleDbSuccess = (
    config: DbConfig,
    columns: string[],
    _totalRows: number,
    details?: DbColumnMetadata[]
  ) => {
    setDbConfig(config);
    setDbColumns(columns);
    setColumnDetails(details || []);
    onConnected();
  };

  const handleDbStatusChange = (status: DbConnectionStatusPayload) => {
    setIsDbConnected(status.isConnected && status.columns.length > 0);
  };

  return {
    dbConfig,
    dbColumns,
    columnDetails,
    isDbConnected,
    dbFormRef,
    handleDbSuccess,
    handleDbStatusChange,
  };
}
