const ZIP_EXTENSION_PATTERN = /\.zip$/i;

export const getShpReplaceUnavailableReason = (file: File | null): string | null => {
  if (!file) {
    return "El reemplazo completo necesita el .zip original. Vuelva a cargar el archivo en el paso anterior.";
  }
  if (!ZIP_EXTENSION_PATTERN.test(file.name)) {
    return "El reemplazo completo solo está disponible para Shapefile en .zip. El archivo cargado no es un .zip.";
  }
  return null;
};
