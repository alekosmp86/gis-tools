import { useState, useEffect } from "react";
import { INITIAL_DB_CONFIG } from "@/data/dbConfigData";
import { useFetchDbColumns } from "@/hooks/useDbQueries";
import {
  saveDbConfigToLocalStorage,
  loadDbConfigFromLocalStorage,
  clearDbConfigFromLocalStorage,
} from "@/services/localStorageDbConfig";
import { AlertType } from "@/types/ui";
import type { DbConfig, DbColumnMetadata, DbConnectionFormProps } from "@/types/db";

export function useDbConnectionForm(onSuccess: DbConnectionFormProps["onSuccess"]) {
  const [config, setConfig] = useState<DbConfig>(INITIAL_DB_CONFIG);
  const [statusMessage, setStatusMessage] = useState<{
    type: AlertType;
    text: string;
  } | null>(null);
  const [columnsLoaded, setColumnsLoaded] = useState<string[]>([]);
  const [columnDetailsLoaded, setColumnDetailsLoaded] = useState<DbColumnMetadata[]>([]);
  const [totalRowsLoaded, setTotalRowsLoaded] = useState<number | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [hasSavedConfig, setHasSavedConfig] = useState<boolean>(false);
  const [autoSave, setAutoSave] = useState(true);

  // Client-side hydration from localStorage post-mount
  useEffect(() => {
    const saved = loadDbConfigFromLocalStorage();
    if (saved) {
      queueMicrotask(() => {
        setConfig((prev) => ({ ...prev, ...saved, password: "" }));
        setHasSavedConfig(true);
      });
    }
  }, []);

  const fetchColumnsMutation = useFetchDbColumns();

  const handleChange = (field: keyof DbConfig, value: string) => {
    setConfig((prev) => ({ ...prev, [field]: value }));
    setStatusMessage(null);
    setIsConnected(false);
    setColumnsLoaded([]);
    setColumnDetailsLoaded([]);
    setTotalRowsLoaded(null);
  };

  const handleConnectAndFetchColumns = () => {
    if (!config.db_name || !config.user || !config.table_name) {
      setStatusMessage({
        type: AlertType.ERROR,
        text: "Por favor ingrese el nombre de la base de datos, usuario y nombre de la tabla.",
      });
      return;
    }

    setStatusMessage(null);
    setIsConnected(false);

    fetchColumnsMutation.mutate(config, {
      onSuccess: (data) => {
        setColumnsLoaded(data.columns);
        setColumnDetailsLoaded(data.columnDetails || []);
        setTotalRowsLoaded(data.totalRows);
        setIsConnected(true);

        if (autoSave) {
          saveDbConfigToLocalStorage(config);
          setHasSavedConfig(true);
        }

        setStatusMessage({
          type: AlertType.SUCCESS,
          text: `Conexión establecida con éxito. Se encontraron ${data.columns.length} columnas y ${data.totalRows} registros en '${data.schema}.${data.tableName}'.`,
        });
      },
      onError: (err) => {
        setIsConnected(false);
        setStatusMessage({ type: AlertType.ERROR, text: err.message });
      },
    });
  };

  const handleSaveConfigManual = () => {
    saveDbConfigToLocalStorage(config);
    setHasSavedConfig(true);
    setStatusMessage({
      type: AlertType.SUCCESS,
      text: "Configuración de conexión guardada en el almacenamiento local (sin contraseña).",
    });
  };

  const handleClearSavedConfig = () => {
    clearDbConfigFromLocalStorage();
    setHasSavedConfig(false);
    setStatusMessage({
      type: AlertType.SUCCESS,
      text: "Configuración guardada eliminada del almacenamiento local.",
    });
  };

  const handleProceed = () => {
    if (isConnected && columnsLoaded.length > 0) {
      onSuccess(config, columnsLoaded, totalRowsLoaded || 0, columnDetailsLoaded);
    }
  };

  return {
    config,
    statusMessage,
    columnsLoaded,
    columnDetailsLoaded,
    totalRowsLoaded,
    isConnected,
    hasSavedConfig,
    autoSave,
    isPending: fetchColumnsMutation.isPending,
    setAutoSave,
    handleChange,
    handleConnectAndFetchColumns,
    handleSaveConfigManual,
    handleClearSavedConfig,
    handleProceed,
  };
}
