import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { DbConfig, ColumnsResponse } from "@/types/db";

async function fetchDbColumnsApi(config: DbConfig): Promise<ColumnsResponse> {
  const res = await fetch("/api/db/columns", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });

  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || "No se pudieron obtener las columnas de la tabla.");
  }

  return data;
}

export function useFetchDbColumns() {
  const queryClient = useQueryClient();
  return useMutation<ColumnsResponse, Error, DbConfig>({
    mutationFn: fetchDbColumnsApi,
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["db-columns", variables.db_name, variables.table_name],
      });
    },
  });
}

export interface DbRecordsResponse {
  records: Array<Record<string, unknown>>;
  totalCount: number;
}

export async function fetchDbRecordsApi(config: DbConfig): Promise<DbRecordsResponse> {
  const res = await fetch("/api/db/records", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });

  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || "No se pudieron obtener los registros de la tabla.");
  }

  return {
    records: data.records || [],
    totalCount: data.totalCount || (data.records ? data.records.length : 0),
  };
}

export function useFetchDbRecords() {
  const queryClient = useQueryClient();
  return useMutation<DbRecordsResponse, Error, DbConfig>({
    mutationFn: fetchDbRecordsApi,
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["db-records", variables.db_name, variables.table_name],
      });
    },
  });
}
