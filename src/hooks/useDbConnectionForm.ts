import { useState, useEffect, startTransition } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { INITIAL_DB_CONFIG } from "@/data/dbConfigData";
import { useFetchDbColumns } from "@/hooks/useDbQueries";
import {
  loadDbProfilesFromLocalStorage,
  saveDbProfileToLocalStorage,
  deleteDbProfileFromLocalStorage,
  generateDefaultProfileName,
} from "@/services/localStorageDbConfig";
import { AlertType } from "@/types/ui";
import { formatNumber } from "@/utils/formatters";
import type { DbConfig, DbColumnMetadata, DbConnectionStatusPayload, SavedDbProfile } from "@/types/db";

interface UseDbConnectionFormCallbacks {
  onSuccess: (
    config: DbConfig,
    columns: string[],
    totalRows: number,
    columnDetails?: DbColumnMetadata[]
  ) => void;
  onStatusChange?: (status: DbConnectionStatusPayload) => void;
}

export function useDbConnectionForm(
  onSuccess: UseDbConnectionFormCallbacks["onSuccess"],
  onStatusChange?: UseDbConnectionFormCallbacks["onStatusChange"]
) {
  const queryClient = useQueryClient();
  const [config, setConfig] = useState<DbConfig>(INITIAL_DB_CONFIG);
  const [statusMessage, setStatusMessage] = useState<{
    type: AlertType;
    text: string;
  } | null>(null);
  const [columnsLoaded, setColumnsLoaded] = useState<string[]>([]);
  const [columnDetailsLoaded, setColumnDetailsLoaded] = useState<DbColumnMetadata[]>([]);
  const [totalRowsLoaded, setTotalRowsLoaded] = useState<number | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [savedProfiles, setSavedProfiles] = useState<SavedDbProfile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string>("");
  const [profileNameInput, setProfileNameInput] = useState<string>("");

  // Client-side hydration from localStorage post-mount
  useEffect(() => {
    const profiles = loadDbProfilesFromLocalStorage();
    if (profiles.length > 0) {
      startTransition(() => {
        setSavedProfiles(profiles);
        const first = profiles[0];
        if (first) {
          setConfig((prev) => ({ ...prev, ...first.config, password: "" }));
          setActiveProfileId(first.id);
          setProfileNameInput(first.name);
        }
      });
    }
  }, []);

  const fetchColumnsMutation = useFetchDbColumns();

  const resetStatus = () => {
    setIsConnected(false);
    setColumnsLoaded([]);
    setColumnDetailsLoaded([]);
    setTotalRowsLoaded(null);
    if (onStatusChange) {
      onStatusChange({
        isConnected: false,
        columns: [],
        totalRows: 0,
        columnDetails: [],
        config,
      });
    }
  };

  const handleChange = (field: keyof DbConfig, value: string) => {
    setConfig((prev) => ({ ...prev, [field]: value }));
    setStatusMessage(null);
    resetStatus();
  };

  const handleSelectProfile = (profileId: string) => {
    if (!profileId) {
      handleResetForm();
      return;
    }
    const found = savedProfiles.find((profile) => profile.id === profileId);
    if (found) {
      queryClient.removeQueries({ queryKey: ["datasetComparison"] });
      setConfig((prev) => ({ ...prev, ...found.config, password: "" }));
      setActiveProfileId(found.id);
      setProfileNameInput(found.name);
      setStatusMessage(null);
      resetStatus();
    }
  };

  const handleResetForm = () => {
    queryClient.removeQueries({ queryKey: ["datasetComparison"] });
    setConfig(INITIAL_DB_CONFIG);
    setActiveProfileId("");
    setProfileNameInput("");
    setStatusMessage(null);
    resetStatus();
  };

  const handleConnectAndFetchColumns = () => {
    queryClient.removeQueries({ queryKey: ["datasetComparison"] });
    if (!config.db_name || !config.user || !config.table_name) {
      setStatusMessage({
        type: AlertType.ERROR,
        text: "Por favor ingrese el nombre de la base de datos, usuario y nombre de la tabla.",
      });
      return;
    }

    setStatusMessage(null);
    resetStatus();

    fetchColumnsMutation.mutate(config, {
      onSuccess: (data) => {
        setColumnsLoaded(data.columns);
        setColumnDetailsLoaded(data.columnDetails || []);
        setTotalRowsLoaded(data.totalRows);
        setIsConnected(true);

        if (onStatusChange) {
          onStatusChange({
            isConnected: true,
            columns: data.columns,
            totalRows: data.totalRows,
            columnDetails: data.columnDetails || [],
            config,
          });
        }

        setStatusMessage({
          type: AlertType.SUCCESS,
          text: `Conexión establecida con éxito. Se encontraron ${formatNumber(data.columns.length)} columnas y ${formatNumber(data.totalRows)} registros en '${data.schema}.${data.tableName}'.`,
        });
      },
      onError: (err) => {
        resetStatus();
        setStatusMessage({ type: AlertType.ERROR, text: err.message });
      },
    });
  };

  const handleSaveNewProfile = () => {
    const nameToUse = profileNameInput.trim() || generateDefaultProfileName(config);
    // Passing undefined forces creation of a brand new profile
    const updated = saveDbProfileToLocalStorage(config, nameToUse, undefined);
    setSavedProfiles(updated);
    const newProf = updated[0];
    if (newProf) {
      setActiveProfileId(newProf.id);
      setProfileNameInput(newProf.name);
    }

    setStatusMessage({
      type: AlertType.SUCCESS,
      text: `Nuevo perfil '${nameToUse}' guardado. Total perfiles guardados: ${updated.length}.`,
    });
  };

  const handleUpdateActiveProfile = () => {
    if (!activeProfileId) {
      handleSaveNewProfile();
      return;
    }
    const nameToUse = profileNameInput.trim() || generateDefaultProfileName(config);
    const updated = saveDbProfileToLocalStorage(config, nameToUse, activeProfileId);
    setSavedProfiles(updated);

    setStatusMessage({
      type: AlertType.SUCCESS,
      text: `Perfil '${nameToUse}' actualizado correctamente.`,
    });
  };

  const handleDeleteProfile = (profileId: string) => {
    const target = savedProfiles.find((profile) => profile.id === profileId);
    const updated = deleteDbProfileFromLocalStorage(profileId);
    setSavedProfiles(updated);

    if (activeProfileId === profileId) {
      const next = updated[0];
      if (next) {
        setActiveProfileId(next.id);
        setConfig((prev) => ({ ...prev, ...next.config, password: "" }));
        setProfileNameInput(next.name);
      } else {
        handleResetForm();
      }
    }

    setStatusMessage({
      type: AlertType.SUCCESS,
      text: target ? `Perfil '${target.name}' eliminado.` : "Perfil eliminado.",
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
    savedProfiles,
    activeProfileId,
    profileNameInput,
    isPending: fetchColumnsMutation.isPending,
    setProfileNameInput,
    handleChange,
    handleSelectProfile,
    handleResetForm,
    handleConnectAndFetchColumns,
    handleSaveNewProfile,
    handleUpdateActiveProfile,
    handleDeleteProfile,
    handleProceed,
  };
}
