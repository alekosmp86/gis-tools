import {
  type CkanPackage,
  type CkanPackageResponse,
  type CkanResource,
  type VaultResourceMeta,
  type WatchResourceDelta,
  DeltaStatus,
} from "../types/watcher";

/**
 * CkanPortalClient.ts
 * Communicates with CKAN v3 Action APIs (defaulting to catalogodatos.gub.uy)
 * and performs zero-bandwidth delta evaluations.
 */
export class CkanPortalClient {
  public static readonly DEFAULT_PORTAL_HOST = "catalogodatos.gub.uy";

  /**
   * Parses user-provided portal URLs to extract the dataset slug and base host.
   * Handles formats like:
   * - https://catalogodatos.gub.uy/dataset/ide-ejes-vias-circulacion
   * - https://catalogodatos.gub.uy/dataset/ide-ejes-vias-circulacion/resource/...
   * - Plain slug: ide-ejes-vias-circulacion
   */
  public parsePortalUrl(inputUrl: string): { host: string; datasetSlug: string } {
    const trimmed = inputUrl.trim();
    if (!trimmed) {
      throw new Error("La URL o identificador del conjunto de datos no puede estar vacío.");
    }

    if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
      return {
        host: CkanPortalClient.DEFAULT_PORTAL_HOST,
        datasetSlug: trimmed,
      };
    }

    try {
      const parsedUrl = new URL(trimmed);
      const pathname = parsedUrl.pathname;
      const datasetMatch = pathname.match(/\/dataset\/([^/?#]+)/i);

      if (!datasetMatch || !datasetMatch[1]) {
        throw new Error(
          `No se pudo identificar el slug del conjunto de datos en la URL: ${trimmed}`
        );
      }

      return {
        host: parsedUrl.host,
        datasetSlug: datasetMatch[1],
      };
    } catch (parseError) {
      if (parseError instanceof Error && parseError.message.includes("No se pudo identificar")) {
        throw parseError;
      }
      throw new Error(`URL de catálogo no válida: ${trimmed}`);
    }
  }

  /**
   * Queries the CKAN Action API package_show endpoint to retrieve metadata and resource list.
   */
  public async fetchPackageMetadata(
    datasetSlug: string,
    portalHost: string = CkanPortalClient.DEFAULT_PORTAL_HOST
  ): Promise<CkanPackage> {
    const apiUrl = `https://${portalHost}/api/3/action/package_show?id=${encodeURIComponent(datasetSlug)}`;

    const response = await fetch(apiUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "GisTools-CartographyWatcher/1.0",
      },
    });

    if (!response.ok) {
      throw new Error(
        `Error al consultar catálogo CKAN (${response.status} ${response.statusText}): ${apiUrl}`
      );
    }

    const payload = (await response.json()) as CkanPackageResponse;

    if (!payload.success || !payload.result) {
      const errorDetail = payload.error?.message || "Respuesta CKAN no exitosa";
      throw new Error(`El catálogo CKAN rechazó la solicitud: ${errorDetail}`);
    }

    return payload.result;
  }

  /**
   * Downloads a remote resource binary payload as a Buffer.
   */
  public async downloadResourceBinary(url: string): Promise<Buffer> {
    if (!url) {
      throw new Error("No se proporcionó una URL de descarga válida.");
    }

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": "GisTools-CartographyWatcher/1.0",
      },
    });

    if (!response.ok) {
      throw new Error(
        `Error al descargar archivo desde ${url} (${response.status} ${response.statusText})`
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * Compares remote CKAN resource metadata against local vault sidecar metadata
   * to determine if a newer version is available.
   */
  public evaluateResourceDelta(
    remote: CkanResource,
    localMeta?: VaultResourceMeta | null
  ): WatchResourceDelta {
    if (!localMeta) {
      return {
        resource: remote,
        status: DeltaStatus.NOT_DOWNLOADED,
        reason: "Recurso no descargado en el vault local.",
        localMeta: null,
      };
    }

    // 1. Evaluate MD5 checksum delta if available
    if (remote.hash && localMeta.hash && remote.hash !== localMeta.hash) {
      return {
        resource: remote,
        status: DeltaStatus.UPDATE_AVAILABLE,
        reason: `Suma de verificación MD5 modificada (Remoto: ${remote.hash.slice(0, 8)}... vs Local: ${localMeta.hash.slice(0, 8)}...).`,
        localMeta,
      };
    }

    // 2. Evaluate timestamp delta
    const remoteTime = remote.last_modified || remote.metadata_modified;
    if (remoteTime && localMeta.remoteLastModified) {
      const remoteDate = new Date(remoteTime).getTime();
      const localDate = new Date(localMeta.remoteLastModified).getTime();

      if (!isNaN(remoteDate) && !isNaN(localDate) && remoteDate > localDate) {
        return {
          resource: remote,
          status: DeltaStatus.UPDATE_AVAILABLE,
          reason: `Nueva versión publicada en catálogo (${new Date(remoteTime).toLocaleDateString("es-UY")}).`,
          localMeta,
        };
      }
    }

    // 3. Evaluate size delta if both hashes and dates were absent
    if (
      !remote.hash &&
      !remoteTime &&
      remote.size != null &&
      localMeta.fileSize != null &&
      remote.size !== localMeta.fileSize
    ) {
      return {
        resource: remote,
        status: DeltaStatus.UPDATE_AVAILABLE,
        reason: `Tamaño de archivo modificado (${remote.size} bytes vs ${localMeta.fileSize} bytes).`,
        localMeta,
      };
    }

    return {
      resource: remote,
      status: DeltaStatus.UP_TO_DATE,
      reason: "El recurso coincide con la última versión descargada.",
      localMeta,
    };
  }
}
