import { useMutation } from "@tanstack/react-query";
import type { DbConfig, ColumnsResponse, TestConnectionResponse } from "@/types/db";

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

async function testDbConnectionApi(config: DbConfig): Promise<TestConnectionResponse> {
  const res = await fetch("/api/db/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });

  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || "Error al conectar con la base de datos.");
  }

  return data;
}

export function useFetchDbColumns() {
  return useMutation<ColumnsResponse, Error, DbConfig>({
    mutationFn: fetchDbColumnsApi,
  });
}

export function useTestDbConnection() {
  return useMutation<TestConnectionResponse, Error, DbConfig>({
    mutationFn: testDbConnectionApi,
  });
}
