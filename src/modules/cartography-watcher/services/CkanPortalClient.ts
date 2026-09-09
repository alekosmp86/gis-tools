import { DEFAULT_PORTAL_HOST } from "../domain/sourceNaming";
import type { CkanPackage, CkanPackageResponse } from "../types";

/**
 * Talks to the CKAN Action API v3.
 *
 * The fetch implementation is injected, so every branch here — a portal that answers 500, one that
 * returns `success: false`, one that returns something that is not a package — is testable without
 * a network.
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Identifies this client in portal access logs. */
const USER_AGENT = "GisTools-CartographyWatcher/2.0";

/** A portal that has not answered by now is treated as unreachable. */
const REQUEST_TIMEOUT_MS = 20_000;

export class CkanPortalClient {
  private readonly fetchImplementation: FetchLike;

  constructor(fetchImplementation: FetchLike = fetch) {
    this.fetchImplementation = fetchImplementation;
  }

  private buildPackageUrl(datasetSlug: string, portalHost: string): string {
    return `https://${portalHost}/api/3/action/package_show?id=${encodeURIComponent(datasetSlug)}`;
  }

  /** Reads a dataset's metadata and its resource list. */
  public async fetchPackage(
    datasetSlug: string,
    portalHost: string = DEFAULT_PORTAL_HOST
  ): Promise<CkanPackage> {
    const requestUrl = this.buildPackageUrl(datasetSlug, portalHost);

    const response = await this.fetchImplementation(requestUrl, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(
        `El catálogo respondió ${response.status} al consultar "${datasetSlug}" en ${portalHost}.`
      );
    }

    const payload = (await response.json()) as CkanPackageResponse;

    if (!payload.success || !payload.result) {
      const detail = payload.error?.message ?? "respuesta no exitosa";
      throw new Error(`El catálogo rechazó la consulta de "${datasetSlug}": ${detail}.`);
    }

    return payload.result;
  }

  /** Downloads a resource's bytes. */
  public async downloadResource(resourceUrl: string): Promise<Buffer> {
    if (!resourceUrl) {
      throw new Error("El recurso no publica una URL de descarga.");
    }

    const response = await this.fetchImplementation(resourceUrl, {
      headers: { "User-Agent": USER_AGENT },
    });

    if (!response.ok) {
      throw new Error(`La descarga falló con estado ${response.status}: ${resourceUrl}`);
    }

    return Buffer.from(await response.arrayBuffer());
  }
}
