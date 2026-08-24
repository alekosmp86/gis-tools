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
