export const getCsvReplaceUnavailableReason = (file: File | null): string | null =>
  file ? null : "El reemplazo completo necesita el archivo CSV original. Vuelva a cargarlo en el paso anterior.";
