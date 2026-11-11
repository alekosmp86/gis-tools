import { DIRECT_DOWNLOAD_MAX_BYTES, DIRECT_DOWNLOAD_TIMEOUT_MS } from "../constants";
import { assertShapefileZip } from "../domain/directUrl";
import type { FetchLike } from "./CkanPortalClient";

/**
 * Fetches a direct-URL source and proves the answer is a zipped shapefile.
 *
 * Nothing is written anywhere: the bytes live in memory for the length of one request. Fetch,
 * timeout and size cap are injected so each refusal can be provoked without a network.
 */

const USER_AGENT = "GisTools-CartographyWatcher/2.0";
const MS_PER_SECOND = 1000;
const BYTES_PER_MEGABYTE = 1024 * 1024;
const TIMEOUT_ERROR_NAME = "TimeoutError";

export interface DirectDownloadResult {
  readonly content: Buffer;
  readonly warnings: ReadonlyArray<string>;
}

class SizeCapExceededError extends Error {}

export class DirectUrlDownloader {
  private readonly fetchImplementation: FetchLike;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;

  constructor(
    fetchImplementation: FetchLike = fetch,
    timeoutMs: number = DIRECT_DOWNLOAD_TIMEOUT_MS,
    maxBytes: number = DIRECT_DOWNLOAD_MAX_BYTES
  ) {
    this.fetchImplementation = fetchImplementation;
    this.timeoutMs = timeoutMs;
    this.maxBytes = maxBytes;
  }

  /** Downloads the URL and validates it as in WD-6; throws a Spanish message on any failure. */
  public async downloadShapefileZip(url: string): Promise<DirectDownloadResult> {
    const content = await this.fetchBytes(url);
    const warnings = assertShapefileZip(content);
    return { content, warnings };
  }

  private async fetchBytes(url: string): Promise<Buffer> {
    let response: Response;
    try {
      response = await this.fetchImplementation(url, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error: unknown) {
      throw this.describeTransportFailure(error);
    }

    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`La URL respondió con estado HTTP ${response.status}.`);
    }

    const declaredLength = Number(response.headers.get("Content-Length"));
    if (declaredLength > this.maxBytes) {
      await response.body?.cancel();
      throw this.tooBigError();
    }

    try {
      return await this.readBodyWithinCap(response);
    } catch (error: unknown) {
      throw this.describeTransportFailure(error);
    }
  }

  private async readBodyWithinCap(response: Response): Promise<Buffer> {
    if (!response.body) {
      const wholeBody = Buffer.from(await response.arrayBuffer());
      if (wholeBody.byteLength > this.maxBytes) {
        throw this.tooBigError();
      }
      return wholeBody;
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let receivedBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      receivedBytes += value.byteLength;
      if (receivedBytes > this.maxBytes) {
        await reader.cancel();
        throw this.tooBigError();
      }
      chunks.push(value);
    }

    return Buffer.concat(chunks);
  }

  private tooBigError(): Error {
    return new SizeCapExceededError(
      `El archivo supera el tamaño máximo permitido de ${Math.round(this.maxBytes / BYTES_PER_MEGABYTE)} MB.`
    );
  }

  private describeTransportFailure(error: unknown): Error {
    if (error instanceof SizeCapExceededError) {
      return error;
    }
    if (error instanceof Error && error.name === TIMEOUT_ERROR_NAME) {
      return new Error(
        `La URL no respondió en ${Math.round(this.timeoutMs / MS_PER_SECOND)} segundos.`
      );
    }
    const detail = error instanceof Error ? error.message : "error desconocido";
    return new Error(`No se pudo conectar con la URL: ${detail}.`);
  }
}
