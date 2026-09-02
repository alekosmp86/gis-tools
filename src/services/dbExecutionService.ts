import type {
  DbConfig,
  ExecuteSqlResponse,
  ExecuteChunkProgress,
  ExecuteBatchResult,
} from "@/types/db";
import { formatNumber } from "@/utils/common/ValueFormatter";

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

export async function executeSqlInChunks(
  dbConfig: DbConfig,
  passwordInput: string,
  sqlScript: string,
  onProgress?: (progress: ExecuteChunkProgress) => void,
  chunkSize: number = 500
): Promise<ExecuteBatchResult> {
  const rawLines = sqlScript.split("\n");
  const statements: string[] = [];
  for (const rawLine of rawLines) {
    const line = rawLine.trim();
    if (line.length > 0 && !line.startsWith("--")) {
      statements.push(line);
    }
  }

  const totalStatements = statements.length;
  if (totalStatements === 0) {
    return {
      success: true,
      totalProcessed: 0,
      affectedRows: 0,
      errorCount: 0,
      errors: [],
      message: "No hay sentencias SQL para ejecutar.",
    };
  }

  const totalBatches = Math.ceil(totalStatements / chunkSize);
  let totalAffectedRows = 0;
  let successCount = 0;
  let errorCount = 0;
  const errors: string[] = [];

  const processBatch = async (batchIdx: number): Promise<void> => {
    if (batchIdx >= totalBatches) return;

    const start = batchIdx * chunkSize;
    const end = Math.min(start + chunkSize, totalStatements);
    const chunkStatements = statements.slice(start, end);
    const chunkSql = chunkStatements.join("\n");

    try {
      const res = await executeSqlScript(dbConfig, passwordInput, chunkSql);
      const affected = res.affectedRows ?? chunkStatements.length;
      totalAffectedRows += affected;
      successCount += chunkStatements.length;
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : "Error desconocido en lote";
      errorCount += chunkStatements.length;
      errors.push(`Lote ${batchIdx + 1} (${start + 1}-${end}): ${errMsg}`);
    }

    const processed = end;
    const pct = Math.round((processed / totalStatements) * 100);

    if (onProgress) {
      onProgress({
        currentBatch: batchIdx + 1,
        totalBatches,
        processedStatements: processed,
        totalStatements,
        successCount,
        errorCount,
        pct,
      });
    }

    return processBatch(batchIdx + 1);
  };

  await processBatch(0);

  const isSuccess = errorCount === 0;
  const summaryMessage = isSuccess
    ? `Ejecución completada con éxito. ${formatNumber(successCount)} registros procesados en ${totalBatches} lotes.`
    : `Ejecución finalizada con observaciones: ${formatNumber(successCount)} exitosos, ${formatNumber(errorCount)} con error.`;

  return {
    success: isSuccess,
    totalProcessed: totalStatements,
    affectedRows: totalAffectedRows,
    errorCount,
    errors,
    message: summaryMessage,
  };
}
