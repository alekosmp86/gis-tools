import type { DbConfig, ExecuteSqlResponse } from "@/types/db";


export async function executeSqlScript(
  dbConfig: DbConfig,
  passwordInput: string,
  sqlScript: string
): Promise<ExecuteSqlResponse> {
  const response = await fetch("/api/db/execute", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      host: dbConfig.host,
      port: dbConfig.port,
      db_name: dbConfig.db_name,
      user: dbConfig.user,
      password: passwordInput,
      sqlScript,
    }),
  });

  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.error || "Error al ejecutar el script en la base de datos.");
  }

  return data as ExecuteSqlResponse;
}
