import { DOWNLOAD_URL_REVOKE_DELAY_MS } from "../constants";

/** Hands a blob to the browser as a file download, then releases its URL once the click has been handled. */
export function downloadBlob(blob: Blob, filename: string): void {
  const downloadUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = downloadUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(downloadUrl), DOWNLOAD_URL_REVOKE_DELAY_MS);
}
