import { useState, useRef } from "react";
import type { ParsedFileDataset } from "@/core/types/parsers";
import type { DbConfig, DbConnectionFormRef } from "@/core/types/db";
import type { SpatialSourceType } from "../types";

export function useSpatialExplorerState() {
  const [activeTab, setActiveTab] = useState<SpatialSourceType>("file");

  // File source state
  const [parsedFileDataset, setParsedFileDataset] = useState<ParsedFileDataset | null>(null);

  // Database source state
  const [dbConfig, setDbConfig] = useState<DbConfig | null>(null);
  const [dbColumns, setDbColumns] = useState<string[]>([]);
  const [dbTotalRows, setDbTotalRows] = useState<number>(0);
  const [isDbConnected, setIsDbConnected] = useState<boolean>(false);

  const dbFormRef = useRef<DbConnectionFormRef | null>(null);

  const handleDbSuccess = (config: DbConfig, columns: string[], totalRows: number) => {
    setDbConfig(config);
    setDbColumns(columns);
    setDbTotalRows(totalRows);
  };

  const handleClearFile = () => {
    setParsedFileDataset(null);
  };

  const handleDisconnectDb = () => {
    setDbConfig(null);
  };

  const handleProceedDb = () => {
    dbFormRef.current?.proceed();
  };

  return {
    activeTab,
    setActiveTab,
    parsedFileDataset,
    setParsedFileDataset,
    dbConfig,
    dbColumns,
    dbTotalRows,
    isDbConnected,
    setIsDbConnected,
    dbFormRef,
    handleDbSuccess,
    handleClearFile,
    handleDisconnectDb,
    handleProceedDb,
  };
}
